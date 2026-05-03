const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const GITHUB_OWNER     = process.env.GITHUB_OWNER;
const GITHUB_REPO      = process.env.GITHUB_REPO;
const GITHUB_FILE_PATH = 'equipments.json';

// ══════════════════════════════════════════
// FUNÇÕES GITHUB
// ══════════════════════════════════════════

async function githubRequest(endpoint, options = {}) {
    const response = await fetch(`https://api.github.com${endpoint}`, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'AGS-Irrigacao-App',
            ...options.headers
        },
        ...options
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API Error: ${response.status} - ${errorText}`);
    }
    return await response.json();
}

async function readDataFromGitHub() {
    try {
        const file = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`);
        const content = Buffer.from(file.content, 'base64').toString('utf8');
        if (!content || content.trim() === '') { await saveDataToGitHub([]); return []; }
        try {
            const data = JSON.parse(content);
            return data;
        } catch {
            await saveDataToGitHub([]);
            return [];
        }
    } catch (error) {
        if (error.message.includes('404')) { await saveDataToGitHub([]); return []; }
        console.error('Erro ao ler GitHub:', error.message);
        return [];
    }
}

async function saveDataToGitHub(data) {
    let sha = null;
    try {
        const currentFile = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`);
        sha = currentFile.sha;
    } catch {}

    const content = JSON.stringify(data, null, 2);
    const contentBase64 = Buffer.from(content).toString('base64');

    await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
        method: 'PUT',
        body: JSON.stringify({
            message: `🔧 Atualizar equipamentos - ${new Date().toLocaleString('pt-BR')}`,
            content: contentBase64,
            sha: sha
        })
    });
    return true;
}

function validateEquipment(data) {
    const errors = [];
    if (!data.name || data.name.trim() === '') errors.push('Nome obrigatório');
    if (!data.type || data.type.trim() === '') errors.push('Tipo obrigatório');
    return errors;
}

// ══════════════════════════════════════════
// MIDDLEWARE LOGGING
// ══════════════════════════════════════════
app.use((req, res, next) => {
    console.log(`📍 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ══════════════════════════════════════════
// API EQUIPAMENTOS
// ══════════════════════════════════════════

// GET /api/equipments — lista todos
app.get('/api/equipments', async (req, res) => {
    try {
        const equipments = await readDataFromGitHub();
        res.json(equipments);
    } catch (error) {
        res.status(500).json({ error: 'Falha ao carregar equipamentos', details: error.message });
    }
});

// GET /api/equipments/:id — busca um
app.get('/api/equipments/:id', async (req, res) => {
    try {
        const equipments = await readDataFromGitHub();
        const equipment = equipments.find(eq => eq.id === req.params.id);
        if (!equipment) return res.status(404).json({ error: 'Equipamento não encontrado' });
        res.json(equipment);
    } catch (error) {
        res.status(500).json({ error: 'Falha ao buscar equipamento', details: error.message });
    }
});

// POST /api/equipments — cria novo
// A URL é gerada automaticamente como /painel?id=<ID>
app.post('/api/equipments', async (req, res) => {
    try {
        const { name, type, location, description } = req.body;

        const validationErrors = validateEquipment({ name, type });
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: 'Dados inválidos', details: validationErrors });
        }

        const equipments = await readDataFromGitHub();
        const id = Date.now().toString();

        // URL gerada automaticamente — aponta para /painel?id=<id>
        const newEquipment = {
            id,
            name: name.trim(),
            type: type.trim(),
            location: location ? location.trim() : '',
            url: `/painel?id=${id}`,           // ← automático
            description: description ? description.trim() : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        equipments.push(newEquipment);
        await saveDataToGitHub(equipments);

        console.log(`✅ Equipamento criado: ${newEquipment.name} (ID: ${id})`);
        res.status(201).json(newEquipment);
    } catch (error) {
        res.status(500).json({ error: 'Falha ao criar equipamento', details: error.message });
    }
});

// PUT /api/equipments/:id — atualiza
app.put('/api/equipments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, type, location, description } = req.body;

        const validationErrors = validateEquipment({ name, type });
        if (validationErrors.length > 0) {
            return res.status(400).json({ error: 'Dados inválidos', details: validationErrors });
        }

        const equipments = await readDataFromGitHub();
        const idx = equipments.findIndex(eq => eq.id === id);
        if (idx === -1) return res.status(404).json({ error: 'Equipamento não encontrado' });

        equipments[idx] = {
            ...equipments[idx],
            name: name.trim(),
            type: type.trim(),
            location: location ? location.trim() : '',
            // Mantém a URL atual (já aponta para /painel?id=...)
            // Se o registro antigo tinha URL externa, migra automaticamente:
            url: equipments[idx].url.startsWith('/painel')
                ? equipments[idx].url
                : `/painel?id=${id}`,
            description: description ? description.trim() : '',
            updatedAt: new Date().toISOString()
        };

        await saveDataToGitHub(equipments);
        res.json(equipments[idx]);
    } catch (error) {
        res.status(500).json({ error: 'Falha ao atualizar equipamento', details: error.message });
    }
});

// DELETE /api/equipments/:id — remove
app.delete('/api/equipments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const equipments = await readDataFromGitHub();
        const idx = equipments.findIndex(eq => eq.id === id);
        if (idx === -1) return res.status(404).json({ error: 'Equipamento não encontrado' });

        const deleted = equipments.splice(idx, 1)[0];
        await saveDataToGitHub(equipments);

        res.json({ message: 'Equipamento deletado com sucesso', deletedEquipment: deleted });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao deletar equipamento', details: error.message });
    }
});

// ══════════════════════════════════════════
// ROTAS SISTEMA
// ══════════════════════════════════════════

app.get('/api/health', async (req, res) => {
    try {
        await readDataFromGitHub();
        res.json({
            status: 'healthy',
            service: 'AGS Irrigação API',
            github: 'Conectado',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

app.get('/api/info', async (req, res) => {
    try {
        const equipments = await readDataFromGitHub();
        res.json({
            service: 'AGS Irrigação',
            version: '3.0.0',
            panels: { admin: '/', operator: '/operador', equipment: '/painel?id=<ID>' },
            totalEquipments: equipments.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ══════════════════════════════════════════
// ROTAS DE INTERFACE
// ══════════════════════════════════════════

app.get('/',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/operador',(req, res) => res.sendFile(path.join(__dirname, 'public', 'operador.html')));
app.get('/admin',   (req, res) => res.redirect('/'));

// Rota dinâmica do painel — /painel?id=... → serve o HTML, o JS busca o equipamento pela API
app.get('/painel',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// ══════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════

async function initializeServer() {
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        console.error('❌ Configure: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
        process.exit(1);
    }

    const equipments = await readDataFromGitHub();
    console.log(`✅ GitHub conectado. ${equipments.length} equipamentos.`);

    app.listen(PORT, () => {
        console.log('═'.repeat(55));
        console.log('🚀 AGS IRRIGAÇÃO v3.0 — SERVIDOR INICIADO');
        console.log('═'.repeat(55));
        console.log(`📍 Porta: ${PORT}`);
        console.log('');
        console.log('📊 PAINÉIS:');
        console.log('   🔧 Admin:    /');
        console.log('   👁  Operador: /operador');
        console.log('   ⚡ Painel:   /painel?id=<ID>  ← DINÂMICO');
        console.log('');
        console.log('🔗 API: /api/equipments | /api/health');
        console.log('═'.repeat(55));
    });
}

initializeServer();

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
