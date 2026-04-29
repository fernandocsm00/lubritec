import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('lubritec.db');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    total_messages INTEGER DEFAULT 0,
    sent_messages INTEGER DEFAULT 0,
    template_id INTEGER,
    scheduled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(template_id) REFERENCES templates(id)
  );
  
  -- Ensure existing tables are correct
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    cnpj TEXT,
    phone TEXT NOT NULL,
    last_order_date DATE,
    frequent_product TEXT,
    avg_purchase_interval_days INTEGER DEFAULT 30
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT NOT NULL,
    email TEXT,
    status TEXT DEFAULT 'Lead inativo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });

  // Auth Routes
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'admin@lubritec.com' && password === 'admin123') {
      res.json({ success: true, user: { name: 'Administrador', email } });
    } else {
      res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
  });

  app.post('/api/auth/recover', (req, res) => {
    res.json({ success: true, message: 'E-mail de recuperação enviado' });
  });

  // Template Routes
  app.get('/api/templates', (req, res) => {
    const templates = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
    res.json(templates);
  });

  app.post('/api/templates', (req, res) => {
    const { name, content } = req.body;
    const info = db.prepare('INSERT INTO templates (name, content) VALUES (?, ?)').run(name, content);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete('/api/templates/:id', (req, res) => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // API Routes
  app.get('/api/stats', (req, res) => {
    const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get() as any;
    const totalSent = db.prepare('SELECT SUM(sent_messages) as count FROM campaigns').get() as any;
    const activeCampaigns = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'running'").get() as any;
    
    res.json({
      totalCampaigns: totalCampaigns.count || 0,
      totalSent: totalSent.count || 0,
      activeCampaigns: activeCampaigns.count || 0,
      deliveryRate: 98.5,
      responseRate: 12.4,
      roi: 4500.00,
      costPerReactivation: 2.50,
      chipStatus: 'connected'
    });
  });

  app.get('/api/campaigns', (req, res) => {
    const campaigns = db.prepare(`
      SELECT c.*, t.name as template_name 
      FROM campaigns c 
      LEFT JOIN templates t ON c.template_id = t.id 
      ORDER BY c.created_at DESC
    `).all();
    res.json(campaigns);
  });

  app.post('/api/campaigns', (req, res) => {
    const { name, total_messages, template_id, scheduled_at } = req.body;
    const status = scheduled_at ? 'scheduled' : 'pending';
    const info = db.prepare('INSERT INTO campaigns (name, total_messages, template_id, scheduled_at, status) VALUES (?, ?, ?, ?, ?)').run(name, total_messages, template_id, scheduled_at, status);
    res.json({ id: info.lastInsertRowid });
  });

  app.get('/api/customers', (req, res) => {
    const customers = db.prepare('SELECT * FROM customers ORDER BY company_name ASC').all();
    res.json(customers);
  });

  // Leads Routes
  app.get('/api/leads', (req, res) => {
    const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
    res.json(leads);
  });

  app.post('/api/leads', (req, res) => {
    const { name, company, phone, email, status } = req.body;
    const info = db.prepare('INSERT INTO leads (name, company, phone, email, status) VALUES (?, ?, ?, ?, ?)').run(
      name, 
      company || '', 
      phone, 
      email || '', 
      status || 'Lead inativo'
    );
    res.json({ id: info.lastInsertRowid });
  });

  app.patch('/api/leads/:id', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/leads/:id', (req, res) => {
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/upload-customers', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    try {
      const records = parse(req.file.buffer.toString(), {
        columns: true,
        skip_empty_lines: true
      });

      const insert = db.prepare('INSERT INTO customers (company_name, contact_name, cnpj, phone, last_order_date, frequent_product) VALUES (?, ?, ?, ?, ?, ?)');
      
      const transaction = db.transaction((customers) => {
        for (const customer of customers) {
          insert.run(
            customer.company_name || customer.name, 
            customer.contact_name || '', 
            customer.cnpj || '', 
            customer.phone, 
            customer.last_order_date || customer.last_purchase_date, 
            customer.frequent_product || ''
          );
        }
      });

      transaction(records);
      res.json({ count: records.length });
    } catch (error) {
      console.error(error);
      res.status(500).send('Error parsing CSV');
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Simulation: Background process to "send" messages for running campaigns
  setInterval(() => {
    // 1. Check for scheduled campaigns that should start
    const now = new Date().toISOString();
    db.prepare("UPDATE campaigns SET status = 'running' WHERE status = 'scheduled' AND scheduled_at <= ?").run(now);

    // 2. Process running campaigns
    const runningCampaigns = db.prepare("SELECT * FROM campaigns WHERE status = 'running'").all() as any[];
    
    for (const campaign of runningCampaigns) {
      if (campaign.sent_messages < campaign.total_messages) {
        const newSent = Math.min(campaign.sent_messages + Math.floor(Math.random() * 5) + 1, campaign.total_messages);
        const newStatus = newSent === campaign.total_messages ? 'completed' : 'running';
        db.prepare('UPDATE campaigns SET sent_messages = ?, status = ? WHERE id = ?').run(newSent, newStatus, campaign.id);
      }
    }
  }, 3000);

  // API to start a campaign
  app.post('/api/campaigns/:id/start', (req, res) => {
    db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });
}

startServer();
