"""
Lumina Finanças — Backend API
FastAPI + SQLite + JWT + processamento de CSV + categorização automática.

Como rodar:
    pip install -r requirements.txt
    uvicorn main:app --reload

Documentação interativa: http://localhost:8000/docs
"""
import os, re, io, csv, jwt, sqlite3, secrets, hashlib
from datetime import datetime, date, timedelta
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr

# ============================ CONFIG ============================
DB_PATH = os.getenv("LUMINA_DB", "lumina.db")
JWT_SECRET = os.getenv("LUMINA_SECRET", "troque-esta-chave-secreta-em-producao-2026")
JWT_ALGO = "HS256"
JWT_EXP_HOURS = 24 * 7
CATEGORIAS = ["Alimentação", "Transporte", "Moradia", "Saúde", "Assinaturas",
              "Lazer", "Educação", "Trabalho", "Outros"]

app = FastAPI(title="Lumina Finanças API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=True)

# ============================ DATABASE ============================
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS usuarios(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL,
      role TEXT DEFAULT 'cliente', plano TEXT DEFAULT 'essencial',
      criado_em TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS contas(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      nome TEXT NOT NULL, tipo TEXT DEFAULT 'corrente');
    CREATE TABLE IF NOT EXISTS categorias(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      nome TEXT UNIQUE NOT NULL, regra TEXT);
    CREATE TABLE IF NOT EXISTS transacoes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL,
      categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
      descricao TEXT NOT NULL, valor REAL NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
      data TEXT NOT NULL, observacao TEXT DEFAULT '',
      origem TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS metas(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      nome TEXT NOT NULL, alvo REAL NOT NULL, guardado REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orcamentos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      categoria_id INTEGER REFERENCES categorias(id) ON DELETE CASCADE,
      limite REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS preferencias(
      usuario_id INTEGER, termo TEXT, categoria_id INTEGER,
      PRIMARY KEY(usuario_id, termo));
    CREATE INDEX IF NOT EXISTS idx_tx_user_data ON transacoes(usuario_id, data);
    """)
    conn.commit(); conn.close()

# ============================ AUTH ============================
def hash_senha(senha: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${h}"

def verificar_senha(senha: str, armazenado: str) -> bool:
    salt, h = armazenado.split("$", 1)
    return hash_senha(senha, salt) == armazenado

def criar_token(user_id: int, role: str) -> str:
    payload = {"sub": str(user_id), "role": role,
               "exp": datetime.utcnow() + timedelta(hours=JWT_EXP_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def usuario_atual(authorization: str = Depends(lambda: None)):
    raise NotImplementedError

from fastapi import Header
def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Token não fornecido")
    try:
        payload = jwt.decode(authorization.split()[1], JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sessão expirada — faça login novamente")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    conn = db()
    u = conn.execute("SELECT id,nome,email,role,plano FROM usuarios WHERE id=?",
                     (payload["sub"],)).fetchone()
    conn.close()
    if not u:
        raise HTTPException(401, "Usuário não encontrado")
    return dict(u)

def exigir_role(*roles):
    def dep(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, f"Acesso restrito a: {', '.join(roles)}")
        return user
    return dep

# ============================ SCHEMAS ============================
class RegisterIn(BaseModel):
    nome: str; email: EmailStr; senha: str; plano: str = "essencial"; role: str = "cliente"

class LoginIn(BaseModel):
    email: EmailStr; senha: str; role: Optional[str] = None

class TransacaoIn(BaseModel):
    data: str; descricao: str; valor: float; tipo: str
    categoria: Optional[str] = None; conta: Optional[str] = None; observacao: str = ""

class ImportIn(BaseModel):
    linhas: List[TransacaoIn]; conta: Optional[str] = None

class MetaIn(BaseModel):
    nome: str; alvo: float; guardado: float = 0

class OrcamentoIn(BaseModel):
    categoria: str; limite: float

class RecuperarIn(BaseModel):
    email: EmailStr

# ============================ CATEGORIZAÇÃO ============================
REGRAS = [
    (r"supermercado|mercado|hortifr|padaria|açougue|atacad", "Alimentação"),
    (r"uber|99app|99 pop|cabify|metr[ôo]|ônibus|onibus|combust|posto|shell|ipiranga|petrobras|estaciona", "Transporte"),
    (r"aluguel|condom[ií]nio|iptu|energia|água|agua|\bluz\b|gás|\bgas\b|internet|vivo|claro|\btim\b", "Moradia"),
    (r"farm[aá]cia|drogaria|hospital|cl[ií]nica|dentista|laborat", "Saúde"),
    (r"netflix|spotify|youtube|prime video|disney|hbo|globoplay|assinatura|mensalidade", "Assinaturas"),
    (r"cinema|streaming|show|teatro|\bbar\b|restaurante|lanchonete|pizzaria", "Lazer"),
    (r"curso|escola|faculdade|universidade|livro|udemy|hotmart", "Educação"),
    (r"sal[aá]rio|freela|consultoria|dividendos|reembolso", "Trabalho"),
]

def categorizar(descricao: str, preferidas: dict = None) -> str:
    d = (descricao or "").lower()
    if preferidas:
        for termo, cat in sorted(preferidas.items(), key=lambda x: -len(x[0])):
            if termo in d:
                return cat
    for regex, cat in REGRAS:
        if re.search(regex, d, re.IGNORECASE):
            return cat
    return "Outros"

def ensure_categoria(conn, usuario_id: int, nome: str) -> int:
    row = conn.execute("SELECT id FROM categorias WHERE usuario_id=? AND nome=?",
                       (usuario_id, nome)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO categorias(usuario_id,nome) VALUES(?,?)", (usuario_id, nome))
    return cur.lastrowid

def preferencias_usuario(conn, usuario_id: int) -> dict:
    rows = conn.execute("""SELECT p.termo, c.nome FROM preferencias p
                           JOIN categorias c ON c.id=p.categoria_id
                           WHERE p.usuario_id=?""", (usuario_id,)).fetchall()
    return {r["termo"].lower(): r["nome"] for r in rows}

def parse_data(v: str) -> Optional[str]:
    v = (v or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    return None

# ============================ ROTAS — AUTH ============================
@app.post("/api/auth/register")
def register(body: RegisterIn):
    if len(body.senha) < 6:
        raise HTTPException(400, "A senha deve ter ao menos 6 caracteres")
    if body.role not in ("cliente", "funcionario", "admin"):
        raise HTTPException(400, "Role inválida")
    conn = db()
    if conn.execute("SELECT 1 FROM usuarios WHERE email=?", (body.email,)).fetchone():
        conn.close(); raise HTTPException(400, "E-mail já cadastrado")
    cur = conn.execute(
        "INSERT INTO usuarios(nome,email,senha_hash,role,plano) VALUES(?,?,?,?,?)",
        (body.nome, body.email, hash_senha(body.senha), body.role, body.plano))
    uid = cur.lastrowid
    for cat in CATEGORIAS:
        conn.execute("INSERT OR IGNORE INTO categorias(usuario_id,nome) VALUES(?,?)", (uid, cat))
    conn.commit(); conn.close()
    return {"id": uid, "msg": "Conta criada com sucesso"}

@app.post("/api/auth/login")
def login(body: LoginIn):
    conn = db()
    u = conn.execute("SELECT * FROM usuarios WHERE email=?", (body.email,)).fetchone()
    conn.close()
    if not u or not verificar_senha(body.senha, u["senha_hash"]):
        raise HTTPException(401, "E-mail ou senha inválidos")
    if body.role and u["role"] != body.role:
        raise HTTPException(403, f"Acesso de {body.role} não permitido para esta conta")
    return {"access_token": criar_token(u["id"], u["role"]), "token_type": "bearer",
            "role": u["role"], "nome": u["nome"]}

@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    return user

@app.post("/api/auth/recuperar")
def recuperar(body: RecuperarIn):
    # Em produção: enviar e-mail com token de redefinição.
    return {"msg": "Se este e-mail estiver cadastrado, você receberá o link de recuperação em instantes."}

# ============================ ROTAS — TRANSAÇÕES ============================
def row_to_tx(r):
    d = dict(r)
    d["categoria"] = d.pop("cat_nome", None) or "Outros"
    d["conta"] = d.pop("conta_nome", None)
    return d

@app.get("/api/transacoes")
def listar_transacoes(de: Optional[str] = None, ate: Optional[str] = None,
                      categoria: Optional[str] = None, tipo: Optional[str] = None,
                      q: Optional[str] = None, user=Depends(get_current_user)):
    sql = """SELECT t.*, c.nome AS cat_nome, co.nome AS conta_nome FROM transacoes t
             LEFT JOIN categorias c ON c.id=t.categoria_id
             LEFT JOIN contas co ON co.id=t.conta_id WHERE t.usuario_id=?"""
    params = [user["id"]]
    if de: sql += " AND t.data>=?"; params.append(de)
    if ate: sql += " AND t.data<=?"; params.append(ate)
    if tipo: sql += " AND t.tipo=?"; params.append(tipo)
    if categoria: sql += " AND c.nome=?"; params.append(categoria)
    if q: sql += " AND LOWER(t.descricao) LIKE ?"; params.append(f"%{q.lower()}%")
    sql += " ORDER BY t.data DESC, t.id DESC"
    conn = db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [row_to_tx(r) for r in rows]

@app.post("/api/transacoes")
def criar_transacao(body: TransacaoIn, user=Depends(get_current_user)):
    data = parse_data(body.data)
    if not data: raise HTTPException(400, "Data inválida")
    if body.tipo not in ("entrada", "saida"): raise HTTPException(400, "Tipo inválido")
    conn = db()
    cat_nome = body.categoria or categorizar(body.descricao, preferencias_usuario(conn, user["id"]))
    cat_id = ensure_categoria(conn, user["id"], cat_nome)
    conta_id = None
    if body.conta:
        row = conn.execute("SELECT id FROM contas WHERE usuario_id=? AND nome=?",
                           (user["id"], body.conta)).fetchone()
        if row: conta_id = row["id"]
        else: conta_id = conn.execute("INSERT INTO contas(usuario_id,nome) VALUES(?,?)",
                                      (user["id"], body.conta)).lastrowid
    valor = abs(body.valor) if body.tipo == "entrada" else -abs(body.valor)
    cur = conn.execute("""INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data,observacao,origem)
                          VALUES(?,?,?,?,?,?,?,?,'manual')""",
                       (user["id"], conta_id, cat_id, body.descricao, valor, body.tipo, data, body.observacao))
    conn.commit(); conn.close()
    return {"id": cur.lastrowid, "msg": "Movimentação criada"}

@app.put("/api/transacoes/{tid}")
def editar_transacao(tid: int, body: TransacaoIn, user=Depends(get_current_user)):
    conn = db()
    if not conn.execute("SELECT 1 FROM transacoes WHERE id=? AND usuario_id=?",
                        (tid, user["id"])).fetchone():
        conn.close(); raise HTTPException(404, "Movimentação não encontrada")
    data = parse_data(body.data) or body.data
    cat_id = ensure_categoria(conn, user["id"], body.categoria or categorizar(body.descricao))
    valor = abs(body.valor) if body.tipo == "entrada" else -abs(body.valor)
    conn.execute("""UPDATE transacoes SET data=?,descricao=?,valor=?,tipo=?,categoria_id=?,observacao=? WHERE id=?""",
                 (data, body.descricao, valor, body.tipo, cat_id, body.observacao, tid))
    conn.commit(); conn.close()
    return {"msg": "Movimentação atualizada"}

@app.delete("/api/transacoes/{tid}")
def excluir_transacao(tid: int, user=Depends(get_current_user)):
    conn = db()
    conn.execute("DELETE FROM transacoes WHERE id=? AND usuario_id=?", (tid, user["id"]))
    conn.commit(); conn.close()
    return {"msg": "Movimentação excluída"}


# ============================ IMPORTAÇÃO CSV ============================
def processar_linhas(user_id: int, linhas: List[TransacaoIn], conta: Optional[str], conn) -> dict:
    prefs = preferencias_usuario(conn, user_id)
    conta_id = None
    if conta:
        row = conn.execute("SELECT id FROM contas WHERE usuario_id=? AND nome=?", (user_id, conta)).fetchone()
        conta_id = row["id"] if row else conn.execute(
            "INSERT INTO contas(usuario_id,nome) VALUES(?,?)", (user_id, conta)).lastrowid
    novas, duplicadas, invalidas = 0, 0, 0
    for item in linhas:
        data = parse_data(item.data)
        if not data or not item.descricao or item.valor is None:
            invalidas += 1; continue
        dup = conn.execute("""SELECT 1 FROM transacoes WHERE usuario_id=? AND data=?
                              AND LOWER(descricao)=? AND ABS(valor)=?""",
                           (user_id, data, item.descricao.lower().strip(), round(abs(item.valor), 2))).fetchone()
        if dup:
            duplicadas += 1; continue
        cat_nome = item.categoria or categorizar(item.descricao, prefs)
        cat_id = ensure_categoria(conn, user_id, cat_nome)
        tipo = item.tipo if item.tipo in ("entrada", "saida") else ("entrada" if item.valor > 0 else "saida")
        valor = abs(item.valor) if tipo == "entrada" else -abs(item.valor)
        conn.execute("""INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data,origem)
                        VALUES(?,?,?,?,?,?,?,'importacao')""",
                     (user_id, conta_id, cat_id, item.descricao, valor, tipo, data))
        novas += 1
    conn.commit()
    return {"total": len(linhas), "importadas": novas, "duplicadas": duplicadas, "invalidas": invalidas}

@app.post("/api/importacao/csv")
def importar_json(body: ImportIn, user=Depends(get_current_user)):
    conn = db()
    r = processar_linhas(user["id"], body.linhas, body.conta, conn)
    conn.close()
    return r

@app.post("/api/importacao/upload")
async def importar_arquivo(file: UploadFile = File(...), user=Depends(get_current_user)):
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    linhas = []
    for row in reader:
        desc = row.get("descricao") or row.get("descrição") or row.get("historico") or ""
        valor = str(row.get("valor", "0")).replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
        linhas.append(TransacaoIn(data=row.get("data", ""), descricao=desc,
                                  valor=float(valor or 0),
                                  tipo=(row.get("tipo") or "").lower() or "saida"))
    conn = db()
    r = processar_linhas(user["id"], linhas, None, conn)
    conn.close()
    return r

# ============================ DASHBOARD ============================
@app.get("/api/dashboard")
def dashboard(user=Depends(get_current_user)):
    uid = user["id"]
    hoje = date.today()
    mes_atual = hoje.strftime("%Y-%m")
    mes_ant = (hoje.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    conn = db()
    saldo = conn.execute("SELECT COALESCE(SUM(valor),0) s FROM transacoes WHERE usuario_id=?", (uid,)).fetchone()["s"]
    rec_mes = conn.execute("SELECT COALESCE(SUM(valor),0) s FROM transacoes WHERE usuario_id=? AND tipo='entrada' AND substr(data,1,7)=?",
                           (uid, mes_atual)).fetchone()["s"]
    des_mes = conn.execute("SELECT COALESCE(SUM(-valor),0) s FROM transacoes WHERE usuario_id=? AND tipo='saida' AND substr(data,1,7)=?",
                           (uid, mes_atual)).fetchone()["s"]
    por_cat = {r["nome"]: r["total"] for r in conn.execute(
        """SELECT c.nome, SUM(-t.valor) total FROM transacoes t JOIN categorias c ON c.id=t.categoria_id
           WHERE t.usuario_id=? AND t.tipo='saida' AND substr(t.data,1,7)=? GROUP BY c.nome""", (uid, mes_atual))}
    evolucao = [dict(r) for r in conn.execute(
        """SELECT substr(data,1,7) mes,
           SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) receitas,
           SUM(CASE WHEN tipo='saida' THEN -valor ELSE 0 END) despesas
           FROM transacoes WHERE usuario_id=? GROUP BY mes ORDER BY mes""", (uid,))]
    alertas = []
    for cat, v in por_cat.items():
        ant = conn.execute("""SELECT COALESCE(SUM(-t.valor),0) s FROM transacoes t JOIN categorias c ON c.id=t.categoria_id
            WHERE t.usuario_id=? AND t.tipo='saida' AND c.nome=? AND substr(t.data,1,7)=?""",
            (uid, cat, mes_ant)).fetchone()["s"]
        if ant > 0 and v > ant * 1.2:
            alertas.append({"tipo": "warning", "titulo": f"{cat} em alta",
                            "msg": f"Seus gastos com {cat.lower()} subiram {round((v/ant-1)*100)}% em relação ao mês anterior."})
    for o in conn.execute("""SELECT o.limite, c.nome FROM orcamentos o JOIN categorias c ON c.id=o.categoria_id
                              WHERE o.usuario_id=?""", (uid,)):
        gasto = por_cat.get(o["nome"], 0)
        if o["limite"] > 0 and gasto >= o["limite"] * 0.9:
            alertas.append({"tipo": "danger", "titulo": f"Orçamento de {o['nome']}",
                            "msg": f"Você já utilizou {round(gasto/o['limite']*100)}% do orçamento definido para {o['nome'].lower()}."})
    conn.close()
    return {"saldo": saldo, "receitas_mes": rec_mes, "despesas_mes": des_mes,
            "economia_mes": rec_mes - des_mes, "por_categoria": por_cat,
            "alertas": alertas, "evolucao": evolucao}

# ============================ METAS / ORÇAMENTOS ============================
@app.get("/api/metas")
def listar_metas(user=Depends(get_current_user)):
    conn = db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM metas WHERE usuario_id=? ORDER BY id", (user["id"],))]
    conn.close(); return rows

@app.post("/api/metas")
def criar_meta(body: MetaIn, user=Depends(get_current_user)):
    conn = db()
    cur = conn.execute("INSERT INTO metas(usuario_id,nome,alvo,guardado) VALUES(?,?,?,?)",
                       (user["id"], body.nome, body.alvo, body.guardado))
    conn.commit(); conn.close()
    return {"id": cur.lastrowid}

@app.put("/api/metas/{mid}")
def editar_meta(mid: int, body: MetaIn, user=Depends(get_current_user)):
    conn = db()
    conn.execute("UPDATE metas SET nome=?,alvo=?,guardado=? WHERE id=? AND usuario_id=?",
                 (body.nome, body.alvo, body.guardado, mid, user["id"]))
    conn.commit(); conn.close()
    return {"msg": "Meta atualizada"}

@app.delete("/api/metas/{mid}")
def excluir_meta(mid: int, user=Depends(get_current_user)):
    conn = db()
    conn.execute("DELETE FROM metas WHERE id=? AND usuario_id=?", (mid, user["id"]))
    conn.commit(); conn.close()
    return {"msg": "Meta excluída"}

@app.get("/api/orcamentos")
def listar_orcamentos(user=Depends(get_current_user)):
    conn = db()
    rows = [dict(r) for r in conn.execute(
        "SELECT o.id, o.limite, c.nome categoria FROM orcamentos o JOIN categorias c ON c.id=o.categoria_id WHERE o.usuario_id=?",
        (user["id"],))]
    conn.close(); return rows

@app.post("/api/orcamentos")
def criar_orcamento(body: OrcamentoIn, user=Depends(get_current_user)):
    conn = db()
    cat_id = ensure_categoria(conn, user["id"], body.categoria)
    cur = conn.execute("INSERT OR REPLACE INTO orcamentos(usuario_id,categoria_id,limite) VALUES(?,?,?)",
                       (user["id"], cat_id, body.limite))
    conn.commit(); conn.close()
    return {"id": cur.lastrowid}

@app.delete("/api/orcamentos/{oid}")
def excluir_orcamento(oid: int, user=Depends(get_current_user)):
    conn = db()
    conn.execute("DELETE FROM orcamentos WHERE id=? AND usuario_id=?", (oid, user["id"]))
    conn.commit(); conn.close()
    return {"msg": "Orçamento removido"}

# ============================ RELATÓRIOS ============================
@app.get("/api/relatorios/mensal")
def relatorio_mensal(ano: int, mes: int, user=Depends(get_current_user)):
    prefix = f"{ano:04d}-{mes:02d}"
    conn = db()
    rec = conn.execute("SELECT COALESCE(SUM(valor),0) s FROM transacoes WHERE usuario_id=? AND tipo='entrada' AND substr(data,1,7)=?",
                       (user["id"], prefix)).fetchone()["s"]
    des = conn.execute("SELECT COALESCE(SUM(-valor),0) s FROM transacoes WHERE usuario_id=? AND tipo='saida' AND substr(data,1,7)=?",
                       (user["id"], prefix)).fetchone()["s"]
    cats = [dict(r) for r in conn.execute(
        """SELECT c.nome categoria, SUM(-t.valor) total FROM transacoes t JOIN categorias c ON c.id=t.categoria_id
           WHERE t.usuario_id=? AND t.tipo='saida' AND substr(t.data,1,7)=? GROUP BY c.nome ORDER BY total DESC""",
        (user["id"], prefix))]
    conn.close()
    return {"receitas": rec, "despesas": des, "saldo": rec - des,
            "maiores_categorias": cats}

# ============================ ADMIN / FUNCIONÁRIO ============================
@app.get("/api/admin/stats")
def admin_stats(user=Depends(exigir_role("admin"))):
    conn = db()
    stats = {
        "usuarios": conn.execute("SELECT COUNT(*) c FROM usuarios WHERE role='cliente'").fetchone()["c"],
        "ativos_mes": conn.execute("SELECT COUNT(DISTINCT usuario_id) c FROM transacoes WHERE substr(created_at,1,7)=date('now','start of month','localtime')").fetchone()["c"],
        "receita_mrr": conn.execute("""SELECT COALESCE(SUM(CASE plano WHEN 'pro' THEN 19.90 WHEN 'business' THEN 49.90 ELSE 0 END),0) m
                                       FROM usuarios WHERE role='cliente'""").fetchone()["m"],
        "importacoes_mes": conn.execute("SELECT COUNT(*) c FROM transacoes WHERE origem='importacao' AND substr(created_at,1,7)=date('now','start of month','localtime')").fetchone()["c"],
        "ultimos_usuarios": [dict(r) for r in conn.execute(
            "SELECT nome,email,plano,criado_em criado FROM usuarios ORDER BY id DESC LIMIT 8")],
    }
    conn.close(); return stats

@app.get("/api/funcionario/chamados")
def fila_chamados(user=Depends(exigir_role("funcionario", "admin"))):
    # Em produção: tabela de chamados. Dados ilustrativos da fila.
    return [
        {"id": 1, "usuario": "Mariana Duarte", "assunto": "Importação CSV rejeitada", "status": "aberto", "criado": "2026-09-12"},
        {"id": 2, "usuario": "Rafael Lima", "assunto": "Dúvida sobre plano Pro", "status": "aberto", "criado": "2026-09-12"},
        {"id": 3, "usuario": "João Souza", "assunto": "Exportação de relatório em PDF", "status": "andamento", "criado": "2026-09-11"},
        {"id": 4, "usuario": "Ana Costa", "assunto": "Correção de categoria em lote", "status": "resolvido", "criado": "2026-09-09"},
    ]

def seed_demo():
    """Cria contas demo e dados de exemplo na primeira inicialização
    (somente quando o banco está vazio — não sobrescreve dados existentes)."""
    conn = db()
    if conn.execute("SELECT COUNT(*) c FROM usuarios").fetchone()["c"] > 0:
        conn.close(); return
    usuarios = [
        ("Cliente Demo", "cliente@lumina.com", "cliente", "essencial"),
        ("Funcionário Demo", "func@lumina.com", "funcionario", "pro"),
        ("Admin Demo", "admin@lumina.com", "admin", "business"),
    ]
    uid_cliente = None
    for nome, email, role, plano in usuarios:
        cur = conn.execute(
            "INSERT INTO usuarios(nome,email,senha_hash,role,plano) VALUES(?,?,?,?,?)",
            (nome, email, hash_senha("demo123"), role, plano))
        uid = cur.lastrowid
        if role == "cliente":
            uid_cliente = uid
        for cat in CATEGORIAS:
            conn.execute("INSERT OR IGNORE INTO categorias(usuario_id,nome) VALUES(?,?)", (uid, cat))
    if uid_cliente:
        conn.execute("INSERT INTO contas(usuario_id,nome) VALUES(?,?)", (uid_cliente, "Conta Corrente"))
        conta_id = conn.execute("SELECT id FROM contas WHERE usuario_id=?", (uid_cliente,)).fetchone()["id"]
        cat_ids = {r["nome"]: r["id"] for r in conn.execute(
            "SELECT id,nome FROM categorias WHERE usuario_id=?", (uid_cliente,))}
        transacoes = [
            ("2026-09-01", "Salário", 3500.00, "entrada", "Trabalho"),
            ("2026-09-02", "Supermercado União", 350.50, "saida", "Alimentação"),
            ("2026-09-03", "Internet", 99.90, "saida", "Assinaturas"),
            ("2026-09-05", "Aluguel", 1200.00, "saida", "Moradia"),
            ("2026-09-06", "Uber", 42.30, "saida", "Transporte"),
            ("2026-09-08", "Farmácia Central", 87.40, "saida", "Saúde"),
            ("2026-09-10", "Netflix", 39.90, "saida", "Assinaturas"),
            ("2026-09-12", "iFood", 64.80, "saida", "Alimentação"),
            ("2026-09-15", "Posto Shell", 180.00, "saida", "Transporte"),
            ("2026-09-18", "Curso de Inglês", 199.00, "saida", "Educação"),
            ("2026-09-20", "Cinema", 56.00, "saida", "Lazer"),
            ("2026-08-01", "Salário", 3500.00, "entrada", "Trabalho"),
            ("2026-08-02", "Supermercado União", 310.20, "saida", "Alimentação"),
            ("2026-08-05", "Aluguel", 1200.00, "saida", "Moradia"),
            ("2026-08-06", "Uber", 38.90, "saida", "Transporte"),
            ("2026-08-12", "iFood", 58.40, "saida", "Alimentação"),
            ("2026-08-15", "Farmácia Central", 65.10, "saida", "Saúde"),
            ("2026-08-18", "Curso de Inglês", 199.00, "saida", "Educação"),
            ("2026-08-22", "Cinema", 48.00, "saida", "Lazer"),
        ]
        for data, desc, valor, tipo, cat in transacoes:
            v = valor if tipo == "entrada" else -valor
            conn.execute("""INSERT INTO transacoes(usuario_id,conta_id,categoria_id,descricao,valor,tipo,data,origem)
                            VALUES(?,?,?,?,?,?,?,'importacao')""",
                         (uid_cliente, conta_id, cat_ids.get(cat), desc, v, tipo, data))
        for nome, alvo, guardado in [("Notebook novo", 4000, 1500),
                                     ("Reserva de emergência", 10000, 2750),
                                     ("Viagem para o litoral", 2500, 900)]:
            conn.execute("INSERT INTO metas(usuario_id,nome,alvo,guardado) VALUES(?,?,?,?)",
                         (uid_cliente, nome, alvo, guardado))
        for cat, limite in [("Alimentação", 800), ("Transporte", 400), ("Lazer", 250)]:
            conn.execute("INSERT INTO orcamentos(usuario_id,categoria_id,limite) VALUES(?,?,?)",
                         (uid_cliente, cat_ids.get(cat), limite))
    conn.commit(); conn.close()
    print("Seed demo criado: cliente@lumina.com | func@lumina.com | admin@lumina.com (senha: demo123)")

# ============================ FRONTEND (arquivos estáticos) ============================
# Serve o frontend (HTML/CSS/JS) junto com a API, como um único serviço web.
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/css", StaticFiles(directory=os.path.join(STATIC_DIR, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(STATIC_DIR, "js")), name="js")
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{page_name}.html", include_in_schema=False)
    def servir_pagina(page_name: str):
        caminho = os.path.join(STATIC_DIR, f"{page_name}.html")
        if os.path.isfile(caminho):
            return FileResponse(caminho)
        raise HTTPException(404, "Página não encontrada")

    @app.get("/", include_in_schema=False)
    def servir_index():
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

init_db()
seed_demo()
