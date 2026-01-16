const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÕES
// =============================================

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurações do GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE_PATH = 'equipments.json';

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

/**
 * Função para fazer requisições para a GitHub API
 */
async function githubRequest(endpoint, options = {}) {
    try {
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
    } catch (error) {
        console.error('❌ Erro na requisição GitHub:', error.message);
        throw error;
    }
}

/**
 * Função para ler dados do arquivo JSON no GitHub
 */
async function readDataFromGitHub() {
    try {
        console.log('📖 Lendo dados do GitHub...');
        
        const file = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`);
        
        // Decodificar conteúdo base64
        const content = Buffer.from(file.content, 'base64').toString('utf8');
        
        // Verificar se o conteúdo não está vazio
        if (!content || content.trim() === '') {
            console.log('📁 Arquivo vazio detectado, inicializando com array vazio...');
            await saveDataToGitHub([]);
            return [];
        }
        
        // Tentar fazer parse do JSON
        let data;
        try {
            data = JSON.parse(content);
        } catch (parseError) {
            console.log('❌ Erro no parse do JSON, inicializando com array vazio...');
            await saveDataToGitHub([]);
            return [];
        }
        
        console.log(`✅ Dados carregados: ${data.length} equipamentos`);
        return data;
    } catch (error) {
        if (error.message.includes('404')) {
            console.log('📁 Arquivo não encontrado, criando equipments.json...');
            await saveDataToGitHub([]);
            return [];
        }
        console.error('❌ Erro ao ler dados do GitHub:', error.message);
        return [];
    }
}

/**
 * Função para salvar dados no arquivo JSON no GitHub
 */
async function saveDataToGitHub(data) {
    try {
        console.log('💾 Salvando dados no GitHub...');
        
        let sha = null;
        try {
            const currentFile = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`);
            sha = currentFile.sha;
        } catch (error) {
            console.log('🆕 Criando novo arquivo no GitHub...');
        }

        // Converter dados para JSON
        const content = JSON.stringify(data, null, 2);
        const contentBase64 = Buffer.from(content).toString('base64');

        // Fazer commit no GitHub
        const response = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `🔧 ${data.length > 0 ? 'Atualizar' : 'Inicializar'} equipamentos - ${new Date().toLocaleString('pt-BR')}`,
                content: contentBase64,
                sha: sha
            })
        });

        console.log('✅ Dados salvos com sucesso no GitHub');
        console.log(`🔗 Commit: ${response.commit.html_url}`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar no GitHub:', error.message);
        throw error;
    }
}

/**
 * Função para validar dados do equipamento
 */
function validateEquipment(data) {
    const errors = [];
    
    if (!data.name || data.name.trim() === '') {
        errors.push('Nome do equipamento é obrigatório');
    }
    
    if (!data.type || data.type.trim() === '') {
        errors.push('Tipo do equipamento é obrigatório');
    }
    
    if (!data.url || data.url.trim() === '') {
        errors.push('URL do painel é obrigatória');
    }
    
    // Validar URL
    try {
        new URL(data.url);
    } catch (error) {
        errors.push('URL do painel deve ser uma URL válida');
    }
    
    return errors;
}

// =============================================
// MIDDLEWARES
// =============================================

// Middleware de logging
app.use((req, res, next) => {
    console.log(`📍 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    console.error('❌ Erro não tratado:', error);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
    });
});

// =============================================
// ROTAS DA API
// =============================================

/**
 * GET /api/equipments
 * Lista todos os equipamentos
 */
app.get('/api/equipments', async (req, res) => {
    try {
        console.log('📥 Recebida requisição para listar equipamentos');
        
        const equipments = await readDataFromGitHub();
        
        res.json(equipments);
    } catch (error) {
        console.error('❌ Erro ao listar equipamentos:', error.message);
        res.status(500).json({ 
            error: 'Falha ao carregar equipamentos',
            details: error.message 
        });
    }
});

/**
 * GET /api/equipments/:id
 * Busca um equipamento específico
 */
app.get('/api/equipments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📥 Buscando equipamento ID: ${id}`);
        
        const equipments = await readDataFromGitHub();
        const equipment = equipments.find(eq => eq.id === id);
        
        if (!equipment) {
            return res.status(404).json({
                error: 'Equipamento não encontrado'
            });
        }
        
        res.json(equipment);
    } catch (error) {
        console.error('❌ Erro ao buscar equipamento:', error.message);
        res.status(500).json({ 
            error: 'Falha ao buscar equipamento',
            details: error.message 
        });
    }
});

/**
 * POST /api/equipments
 * Cria um novo equipamento
 */
app.post('/api/equipments', async (req, res) => {
    try {
        console.log('📥 Recebida requisição para criar equipamento:', req.body);
        
        const { name, type, location, url, description } = req.body;
        
        // Validar dados
        const validationErrors = validateEquipment({ name, type, url });
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: validationErrors
            });
        }
        
        // Ler dados atuais
        const equipments = await readDataFromGitHub();
        
        // Criar novo equipamento
        const newEquipment = {
            id: Date.now().toString(),
            name: name.trim(),
            type: type.trim(),
            location: location ? location.trim() : '',
            url: url.trim(),
            description: description ? description.trim() : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Adicionar à lista
        equipments.push(newEquipment);
        
        // Salvar no GitHub
        await saveDataToGitHub(equipments);
        
        console.log(`✅ Equipamento criado: ${newEquipment.name} (ID: ${newEquipment.id})`);
        
        res.status(201).json(newEquipment);
    } catch (error) {
        console.error('❌ Erro ao criar equipamento:', error.message);
        res.status(500).json({ 
            error: 'Falha ao criar equipamento',
            details: error.message 
        });
    }
});

/**
 * PUT /api/equipments/:id
 * Atualiza um equipamento existente
 */
app.put('/api/equipments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, type, location, url, description } = req.body;
        
        console.log(`📥 Recebida requisição para atualizar equipamento ID: ${id}`, req.body);
        
        // Validar dados
        const validationErrors = validateEquipment({ name, type, url });
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: validationErrors
            });
        }
        
        // Ler dados atuais
        const equipments = await readDataFromGitHub();
        const equipmentIndex = equipments.findIndex(eq => eq.id === id);
        
        if (equipmentIndex === -1) {
            return res.status(404).json({
                error: 'Equipamento não encontrado'
            });
        }
        
        // Atualizar equipamento
        equipments[equipmentIndex] = {
            ...equipments[equipmentIndex],
            name: name.trim(),
            type: type.trim(),
            location: location ? location.trim() : '',
            url: url.trim(),
            description: description ? description.trim() : '',
            updatedAt: new Date().toISOString()
        };
        
        // Salvar no GitHub
        await saveDataToGitHub(equipments);
        
        console.log(`✅ Equipamento atualizado: ${equipments[equipmentIndex].name}`);
        
        res.json(equipments[equipmentIndex]);
    } catch (error) {
        console.error('❌ Erro ao atualizar equipamento:', error.message);
        res.status(500).json({ 
            error: 'Falha ao atualizar equipamento',
            details: error.message 
        });
    }
});

/**
 * DELETE /api/equipments/:id
 * Remove um equipamento
 */
app.delete('/api/equipments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📥 Recebida requisição para deletar equipamento ID: ${id}`);
        
        // Ler dados atuais
        const equipments = await readDataFromGitHub();
        const equipmentIndex = equipments.findIndex(eq => eq.id === id);
        
        if (equipmentIndex === -1) {
            return res.status(404).json({
                error: 'Equipamento não encontrado'
            });
        }
        
        const deletedEquipment = equipments[equipmentIndex];
        
        // Remover da lista
        equipments.splice(equipmentIndex, 1);
        
        // Salvar no GitHub
        await saveDataToGitHub(equipments);
        
        console.log(`✅ Equipamento deletado: ${deletedEquipment.name}`);
        
        res.json({
            message: 'Equipamento deletado com sucesso',
            deletedEquipment
        });
    } catch (error) {
        console.error('❌ Erro ao deletar equipamento:', error.message);
        res.status(500).json({ 
            error: 'Falha ao deletar equipamento',
            details: error.message 
        });
    }
});

// =============================================
// ROTAS DO SISTEMA
// =============================================

/**
 * GET /api/health
 * Health check da API
 */
app.get('/api/health', async (req, res) => {
    try {
        // Testar conexão com GitHub
        await readDataFromGitHub();
        
        res.json({
            status: 'healthy',
            service: 'AGS Irrigação API',
            github: {
                connected: true,
                repo: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
                dataFile: GITHUB_FILE_PATH
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: 'Falha na conexão com GitHub',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/info
 * Informações do sistema
 */
app.get('/api/info', async (req, res) => {
    try {
        const equipments = await readDataFromGitHub();
        
        // Estatísticas
        const stats = {
            totalEquipments: equipments.length,
            types: [...new Set(equipments.map(eq => eq.type))],
            pivoCount: equipments.filter(eq => eq.type === 'Pivô Central').length,
            linearCount: equipments.filter(eq => eq.type === 'linear').length,
            aspersorCount: equipments.filter(eq => eq.type === 'aspersor').length,
            lastUpdate: equipments.length > 0 
                ? new Date(Math.max(...equipments.map(eq => new Date(eq.updatedAt || eq.createdAt))))
                : null
        };
        
        res.json({
            service: 'AGS Irrigação',
            version: '2.0.0',
            panels: {
                admin: '/',
                operator: '/operador'
            },
            stats: stats,
            repository: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Falha ao obter informações',
            details: error.message
        });
    }
});

// =============================================
// ROTAS DE INTERFACE
// =============================================

/**
 * GET /
 * Painel Administrativo (Gestão completa)
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /operador
 * Painel do Operador (Somente visualização)
 */
app.get('/operador', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'operador.html'));
});

/**
 * GET /admin
 * Alias para o painel administrativo
 */
app.get('/admin', (req, res) => {
    res.redirect('/');
});

/**
 * Rota para qualquer outra requisição - 404
 */
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Rota não encontrada',
        availableRoutes: {
            api: [
                '/api/equipments',
                '/api/equipments/:id',
                '/api/health',
                '/api/info'
            ],
            panels: [
                '/ - Painel Administrativo',
                '/operador - Painel do Operador',
                '/admin - Alias para Painel Administrativo'
            ]
        }
    });
});

// =============================================
// INICIALIZAÇÃO DO SERVIDOR
// =============================================

async function initializeServer() {
    try {
        // Verificar configurações
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            console.error('❌ Variáveis de ambiente não configuradas corretamente');
            console.log('ℹ️  Configure: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
            process.exit(1);
        }

        console.log('🔗 Testando conexão com GitHub...');
        console.log(`👤 Owner: ${GITHUB_OWNER}`);
        console.log(`📦 Repo: ${GITHUB_REPO}`);
        console.log(`📁 File: ${GITHUB_FILE_PATH}`);
        
        // Testar conexão inicial com GitHub
        const equipments = await readDataFromGitHub();
        console.log(`✅ Conexão estabelecida. ${equipments.length} equipamentos carregados.`);
        
        // Iniciar servidor
        app.listen(PORT, () => {
            console.log('='.repeat(60));
            console.log('🚀 SERVIDOR AGS IRRIGAÇÃO INICIADO!');
            console.log('='.repeat(60));
            console.log(`📍 Porta: ${PORT}`);
            console.log(`🌐 URL Base: https://your-app.onrender.com`);
            console.log('');
            console.log('📊 PAINÉIS DISPONÍVEIS:');
            console.log(`   🔧 Administrativo: /`);
            console.log(`   👨‍💼 Operador: /operador`);
            console.log('');
            console.log('🔗 ENDPOINTS DA API:');
            console.log(`   📋 Listar equipamentos: /api/equipments`);
            console.log(`   ❤️  Health check: /api/health`);
            console.log(`   ℹ️  Informações: /api/info`);
            console.log('');
            console.log(`💾 GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`);
            console.log(`📁 Arquivo de dados: ${GITHUB_FILE_PATH}`);
            console.log('='.repeat(60));
        });
    } catch (error) {
        console.error('❌ Falha na inicialização do servidor:', error.message);
        console.log('💡 Dicas:');
        console.log('   • Verifique se o token GitHub está correto');
        console.log('   • Verifique se o repositório existe');
        console.log('   • Verifique as permissões do token (repo, public_repo)');
        process.exit(1);
    }
}

// Inicializar servidor
initializeServer();

// Tratamento de sinais para graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔻 Recebido SIGINT, encerrando servidor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔻 Recebido SIGTERM, encerrando servidor...');
    process.exit(0);
});
