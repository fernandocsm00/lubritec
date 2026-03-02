import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Send, 
  MessageSquare, 
  Users, 
  Settings, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Menu,
  X,
  Plus,
  FileUp,
  Search,
  ChevronRight,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types
interface Stats {
  totalCampaigns: number;
  totalSent: number;
  activeCampaigns: number;
  deliveryRate: number;
  responseRate: number;
  roi: number;
  costPerReactivation: number;
  chipStatus: string;
}

interface Campaign {
  id: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'paused' | 'scheduled';
  total_messages: number;
  sent_messages: number;
  template_name?: string;
  scheduled_at?: string;
  created_at: string;
}

interface Template {
  id: number;
  name: string;
  content: string;
  created_at: string;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
      fetchCampaigns();

      const interval = setInterval(() => {
        fetchStats();
        fetchCampaigns();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      setCampaigns(data);
      setIsLoading(false);
    } catch (err) {
      console.error('Error fetching campaigns:', err);
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return <Login onLogin={(userData: any) => {
      setUser(userData);
      setIsAuthenticated(true);
    }} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard stats={stats} campaigns={campaigns} />;
      case 'campaigns':
        return <Campaigns campaigns={campaigns} onRefresh={fetchCampaigns} />;
      case 'templates':
        return <Templates />;
      case 'inbox':
        return <Inbox />;
      case 'customers':
        return <Customers />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard stats={stats} campaigns={campaigns} />;
    }
  };

  return (
    <div className="min-h-screen bg-lubritec-light flex font-sans text-lubritec-dark">
      {/* Sidebar */}
      <aside 
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } bg-lubritec-blue text-white transition-all duration-300 flex flex-col fixed h-full z-50 shadow-xl`}
      >
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <div className="w-8 h-8 bg-lubritec-red rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-lubritec-red/20">
            <Send size={18} className="text-white" />
          </div>
          {isSidebarOpen && (
            <span className="font-bold text-lg tracking-tight uppercase">Lubritec</span>
          )}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<Send size={20} />} 
            label="Campanhas" 
            active={activeTab === 'campaigns'} 
            onClick={() => setActiveTab('campaigns')}
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<FileUp size={20} />} 
            label="Modelos (Templates)" 
            active={activeTab === 'templates'} 
            onClick={() => setActiveTab('templates')}
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<MessageSquare size={20} />} 
            label="Inbox" 
            active={activeTab === 'inbox'} 
            onClick={() => setActiveTab('inbox')}
            collapsed={!isSidebarOpen}
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="Clientes" 
            active={activeTab === 'customers'} 
            onClick={() => setActiveTab('customers')}
            collapsed={!isSidebarOpen}
          />
          <div className="pt-4 mt-4 border-t border-white/10">
            <NavItem 
              icon={<Settings size={20} />} 
              label="Configurações" 
              active={activeTab === 'settings'} 
              onClick={() => setActiveTab('settings')}
              collapsed={!isSidebarOpen}
            />
          </div>
        </nav>

        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-4 hover:bg-white/5 flex items-center justify-center border-t border-white/10"
        >
          {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-20'} p-8`}>
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-lubritec-blue">
              {activeTab === 'dashboard' ? 'Painel de Controle' : 
               activeTab === 'campaigns' ? 'Campanhas de Disparo' :
               activeTab === 'inbox' ? 'Conversas Ativas' :
               activeTab === 'customers' ? 'Base de Clientes' : 'Configurações'}
            </h1>
            <p className="text-slate-500 mt-1 font-medium">LubriConnect — Inteligência em Reativação Lubritec.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-white p-1 rounded-full shadow-sm border border-slate-200">
              <div className="w-10 h-10 bg-lubritec-blue rounded-full flex items-center justify-center text-white font-bold">
                {user?.name?.charAt(0) || 'A'}
              </div>
            </div>
          </div>
        </header>

        {renderContent()}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, collapsed }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
        active 
          ? 'bg-lubritec-red text-white shadow-lg shadow-lubritec-red/20' 
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="font-semibold">{label}</span>}
    </button>
  );
}

function Dashboard({ stats, campaigns }: { stats: Stats | null, campaigns: Campaign[] }) {
  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard 
          title="Taxa de Entrega" 
          value={`${stats?.deliveryRate || 0}%`} 
          icon={<CheckCircle2 className="text-emerald-500" />} 
          trend="Estável"
        />
        <StatCard 
          title="Taxa de Resposta" 
          value={`${stats?.responseRate || 0}%`} 
          icon={<TrendingUp className="text-orange-500" />} 
          trend="+2.4%"
        />
        <StatCard 
          title="ROI Reativação" 
          value={`R$ ${stats?.roi.toLocaleString() || '0'}`} 
          icon={<TrendingUp className="text-lubritec-blue" />} 
          trend="+15%"
        />
        <StatCard 
          title="Custo/Reativação" 
          value={`R$ ${stats?.costPerReactivation.toFixed(2) || '0.00'}`} 
          icon={<AlertCircle className="text-lubritec-red" />} 
          trend="-5%"
        />
        <StatCard 
          title="Status Chip" 
          value={stats?.chipStatus === 'connected' ? 'Conectado' : 'Desconectado'} 
          icon={<div className={`w-3 h-3 rounded-full ${stats?.chipStatus === 'connected' ? 'bg-emerald-500' : 'bg-lubritec-red'} animate-pulse`} />} 
          trend="Saúde: 98%"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Campaigns */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold tracking-tight text-lubritec-blue">Campanhas Recentes</h2>
            <button className="text-lubritec-red font-bold text-sm hover:underline">Ver todas</button>
          </div>
          <div className="space-y-4">
            {campaigns.slice(0, 5).map((campaign) => (
              <div key={campaign.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-50 hover:border-slate-200 transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    campaign.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                    campaign.status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    <Send size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">{campaign.name}</h3>
                    <p className="text-xs text-slate-400">{new Date(campaign.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-lubritec-blue" 
                        style={{ width: `${(campaign.sent_messages / campaign.total_messages) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-slate-600">{Math.round((campaign.sent_messages / campaign.total_messages) * 100)}%</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    campaign.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                    campaign.status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {campaign.status}
                  </span>
                </div>
              </div>
            ))}
            {campaigns.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                Nenhuma campanha encontrada.
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-6">
          <div className="bg-lubritec-blue text-white rounded-3xl p-8 shadow-xl">
            <h2 className="text-xl font-bold mb-4">Ações Rápidas</h2>
            <div className="space-y-3">
              <QuickActionBtn icon={<Plus size={18} />} label="Nova Campanha" primary />
              <QuickActionBtn icon={<FileUp size={18} />} label="Importar Clientes" />
              <QuickActionBtn icon={<Database size={18} />} label="Backup de Dados" />
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold mb-4 text-lubritec-blue">Saúde do Sistema</h2>
            <div className="space-y-4">
              <HealthItem label="API WhatsApp" status="online" />
              <HealthItem label="Banco de Dados" status="online" />
              <HealthItem label="Servidor de Disparo" status="online" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: any) {
  return (
    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-slate-50 rounded-2xl">
          {icon}
        </div>
        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
          {trend}
        </span>
      </div>
      <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider">{title}</h3>
      <p className="text-xl font-extrabold mt-1 tracking-tight text-lubritec-blue">{value}</p>
    </div>
  );
}

function QuickActionBtn({ icon, label, primary }: any) {
  return (
    <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${
      primary 
        ? 'bg-lubritec-red text-white hover:bg-red-700 shadow-lg shadow-lubritec-red/20' 
        : 'bg-white/10 text-white hover:bg-white/20'
    }`}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HealthItem({ label, status }: any) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm font-medium text-[#78716C]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-[#1C1917] capitalize">{status}</span>
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
      </div>
    </div>
  );
}

function Campaigns({ campaigns, onRefresh }: { campaigns: Campaign[], onRefresh: () => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newCampaign, setNewCampaign] = useState({ 
    name: '', 
    total_messages: 0, 
    template_id: '', 
    scheduled_at: '' 
  });

  useEffect(() => {
    fetch('/api/templates').then(res => res.json()).then(setTemplates);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCampaign),
      });
      setIsModalOpen(false);
      setNewCampaign({ name: '', total_messages: 0, template_id: '', scheduled_at: '' });
      onRefresh();
    } catch (err) {
      console.error('Error creating campaign:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A29E]" size={18} />
          <input 
            type="text" 
            placeholder="Buscar campanhas..." 
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-lubritec-blue/20"
          />
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-lubritec-red text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-lubritec-red/20"
        >
          <Plus size={20} />
          Nova Campanha
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Nome / Modelo</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Progresso</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Agendamento</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-bold text-lubritec-dark">{campaign.name}</span>
                    <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                      Modelo: {campaign.template_name || 'Nenhum'}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
                    campaign.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                    campaign.status === 'running' ? 'bg-blue-100 text-blue-600' : 
                    campaign.status === 'scheduled' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {campaign.status === 'scheduled' ? 'Agendada' : 
                     campaign.status === 'running' ? 'Enviando' :
                     campaign.status === 'completed' ? 'Concluída' : 'Pendente'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-lubritec-blue" 
                        style={{ width: `${(campaign.sent_messages / campaign.total_messages) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      {campaign.sent_messages}/{campaign.total_messages}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">
                  {campaign.scheduled_at ? (
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className="text-lubritec-red" />
                      <span>{new Date(campaign.scheduled_at).toLocaleString()}</span>
                    </div>
                  ) : (
                    <span className="italic text-slate-300">Imediato</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    {campaign.status === 'pending' && (
                      <button 
                        onClick={async () => {
                          await fetch(`/api/campaigns/${campaign.id}/start`, { method: 'POST' });
                          onRefresh();
                        }}
                        className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
                        title="Iniciar Campanha"
                      >
                        <Send size={16} />
                      </button>
                    )}
                    <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                      <ChevronRight size={18} className="text-slate-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-lubritec-dark/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-extrabold text-lubritec-blue mb-6">Criar Nova Campanha</h2>
              <form onSubmit={handleCreate} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Nome da Campanha</label>
                  <input 
                    required
                    type="text" 
                    value={newCampaign.name}
                    onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                    placeholder="Ex: Reativação Clientes Inativos"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Modelo de Mensagem</label>
                    <select 
                      required
                      value={newCampaign.template_id}
                      onChange={(e) => setNewCampaign({ ...newCampaign, template_id: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                    >
                      <option value="">Selecione...</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Total de Disparos</label>
                    <input 
                      required
                      type="number" 
                      value={newCampaign.total_messages || ''}
                      onChange={(e) => setNewCampaign({ ...newCampaign, total_messages: parseInt(e.target.value) })}
                      placeholder="Ex: 500"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Agendamento (Opcional)</label>
                  <input 
                    type="datetime-local" 
                    value={newCampaign.scheduled_at}
                    onChange={(e) => setNewCampaign({ ...newCampaign, scheduled_at: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                  />
                  <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Deixe em branco para disparar imediatamente após o início.</p>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 bg-lubritec-red text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-lg shadow-lubritec-red/20"
                  >
                    Salvar Campanha
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', content: '' });

  const fetchTemplates = () => {
    fetch('/api/templates').then(res => res.json()).then(setTemplates);
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTemplate),
    });
    setIsModalOpen(false);
    setNewTemplate({ name: '', content: '' });
    fetchTemplates();
  };

  const insertVariable = (variable: string) => {
    setNewTemplate({ ...newTemplate, content: newTemplate.content + ` {{${variable}}}` });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-lubritec-blue">Modelos de Mensagem</h2>
          <p className="text-sm text-slate-500 mt-1">Crie mensagens dinâmicas com variáveis personalizadas.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-lubritec-blue text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-900 transition-all shadow-lg shadow-lubritec-blue/20"
        >
          <Plus size={20} />
          Novo Modelo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(t => (
          <div key={t.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold text-lubritec-blue">{t.name}</h3>
              <button 
                onClick={async () => {
                  await fetch(`/api/templates/${t.id}`, { method: 'DELETE' });
                  fetchTemplates();
                }}
                className="text-slate-300 hover:text-lubritec-red transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl flex-1 mb-4">
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{t.content}</p>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">{new Date(t.created_at).toLocaleDateString()}</span>
              <button className="text-lubritec-red font-bold text-xs hover:underline">Editar</button>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-lubritec-dark/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-extrabold text-lubritec-blue mb-6">Editor de Modelo Dinâmico</h2>
              <form onSubmit={handleCreate} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Nome do Modelo</label>
                  <input 
                    required
                    type="text" 
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="Ex: Alerta de Troca de Óleo"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">Conteúdo da Mensagem</label>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {['nome', 'veiculo', 'placa', 'data_ultima_troca', 'proxima_troca'].map(v => (
                      <button 
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-lubritec-blue hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all text-slate-500"
                      >
                        +{v}
                      </button>
                    ))}
                  </div>
                  <textarea 
                    required
                    rows={6}
                    value={newTemplate.content}
                    onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                    placeholder="Olá {{nome}}, notamos que seu {{veiculo}}..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium resize-none"
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 bg-lubritec-blue text-white font-bold rounded-2xl hover:bg-blue-900 transition-all shadow-lg shadow-lubritec-blue/20"
                  >
                    Salvar Modelo
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Inbox() {
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-[#E7E5E4] h-[calc(100vh-250px)] flex overflow-hidden">
      {/* Chat List */}
      <div className="w-80 border-r border-[#E7E5E4] flex flex-col">
        <div className="p-4 border-b border-[#E7E5E4]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A29E]" size={16} />
            <input 
              type="text" 
              placeholder="Buscar conversas..." 
              className="w-full pl-10 pr-4 py-2 bg-[#F5F5F4] rounded-xl text-sm focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`p-4 border-b border-[#F5F5F4] hover:bg-[#F5F5F4]/50 cursor-pointer transition-colors ${i === 1 ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : ''}`}>
              <div className="flex justify-between items-start mb-1">
                <span className="font-bold text-sm">João Silva</span>
                <span className="text-[10px] text-[#A8A29E]">12:45</span>
              </div>
              <p className="text-xs text-[#78716C] truncate">Olá, gostaria de agendar uma troca de óleo...</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-[#F5F5F4]/30">
        <div className="p-4 bg-white border-b border-[#E7E5E4] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#D6D3D1] rounded-full"></div>
            <div>
              <h3 className="font-bold text-sm">João Silva</h3>
              <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">Online</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="p-2 hover:bg-[#F5F5F4] rounded-lg transition-colors text-[#78716C]">
              <AlertCircle size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm max-w-md">
              <p className="text-sm">Olá! Vi a mensagem sobre a promoção de troca de óleo. Ainda está valendo?</p>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="bg-emerald-500 text-white p-4 rounded-2xl rounded-tr-none shadow-md max-w-md">
              <p className="text-sm">Olá, João! Sim, está valendo até o final desta semana. Gostaria de agendar para qual dia?</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white border-t border-[#E7E5E4]">
          <div className="flex gap-3">
            <input 
              type="text" 
              placeholder="Digite sua mensagem..." 
              className="flex-1 px-4 py-3 bg-[#F5F5F4] rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <button className="bg-emerald-500 text-white p-3 rounded-2xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Customers() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload-customers', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setUploadResult(data);
    } catch (err) {
      console.error('Error uploading file:', err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-lubritec-blue">Base de Clientes</h2>
          <p className="text-sm text-slate-500 mt-1">Gerencie sua lista de contatos para reativação.</p>
        </div>
        <div className="flex gap-3">
          <label className="bg-lubritec-blue text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-900 transition-all cursor-pointer shadow-lg shadow-lubritec-blue/20">
            <FileUp size={20} />
            {isUploading ? 'Enviando...' : 'Importar Planilha'}
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
          </label>
        </div>
      </div>

      {uploadResult && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3"
        >
          <CheckCircle2 className="text-emerald-500" size={20} />
          <span className="text-emerald-800 font-bold text-sm">
            Sucesso! {uploadResult.count} clientes importados com sucesso.
          </span>
        </motion.div>
      )}

      <div className="text-center py-20 border-2 border-dashed border-slate-100 rounded-3xl">
        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <Users size={40} className="text-slate-300" />
        </div>
        <h3 className="font-extrabold text-xl text-slate-800">Nenhum cliente importado</h3>
        <p className="text-slate-500 max-w-xs mx-auto mt-2 font-medium">
          Importe sua planilha CSV com os dados dos clientes para iniciar as campanhas de reativação inteligente.
        </p>
        <button className="mt-8 text-lubritec-red font-bold flex items-center gap-2 mx-auto hover:underline">
          <FileUp size={18} />
          Baixar Modelo de Planilha
        </button>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (userData: any) => void }) {
  const [email, setEmail] = useState('admin@lubritec.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        onLogin(data.user);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Erro ao conectar ao servidor');
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail }),
      });
      const data = await res.json();
      setRecoveryMessage(data.message);
    } catch (err) {
      setError('Erro ao enviar recuperação');
    }
  };

  return (
    <div className="min-h-screen bg-lubritec-light flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-md rounded-3xl p-10 shadow-2xl border border-slate-200"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 bg-lubritec-blue rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-lubritec-blue/20">
            <Send size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-lubritec-blue uppercase">Lubritec</h1>
          <p className="text-slate-500 font-bold text-sm mt-1">LUBRICONNECT</p>
        </div>

        {!isRecovering ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-4 bg-red-50 text-lubritec-red text-sm rounded-2xl border border-red-100 flex items-center gap-3 font-bold">
                <AlertCircle size={18} />
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">E-mail Corporativo</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                placeholder="seu@lubritec.com.br"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Senha de Acesso</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-lubritec-blue text-white py-4 rounded-2xl font-extrabold hover:bg-blue-900 transition-all shadow-lg shadow-lubritec-blue/20 text-lg"
            >
              Acessar Painel
            </button>
            <button 
              type="button"
              onClick={() => setIsRecovering(true)}
              className="w-full text-sm font-bold text-slate-400 hover:text-lubritec-red transition-colors"
            >
              Esqueceu sua senha?
            </button>
          </form>
        ) : (
          <form onSubmit={handleRecover} className="space-y-5">
            <h2 className="text-xl font-extrabold text-lubritec-blue mb-2">Recuperar Acesso</h2>
            <p className="text-sm text-slate-500 mb-6 font-medium">Insira seu e-mail corporativo para receber as instruções de redefinição.</p>
            {recoveryMessage && (
              <div className="p-4 bg-emerald-50 text-emerald-600 text-sm rounded-2xl border border-emerald-100 flex items-center gap-3 font-bold">
                <CheckCircle2 size={18} />
                {recoveryMessage}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">E-mail</label>
              <input 
                type="email" 
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-lubritec-blue focus:outline-none transition-all font-medium"
                placeholder="seu@lubritec.com.br"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-lubritec-blue text-white py-4 rounded-2xl font-extrabold hover:bg-blue-900 transition-all shadow-lg shadow-lubritec-blue/20"
            >
              Enviar Instruções
            </button>
            <button 
              type="button"
              onClick={() => {
                setIsRecovering(false);
                setRecoveryMessage('');
              }}
              className="w-full text-sm font-bold text-slate-400 hover:text-lubritec-blue transition-colors"
            >
              Voltar para o Login
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

function SettingsPage() {
  const [dataSource, setDataSource] = useState('spreadsheet');

  return (
    <div className="max-w-4xl space-y-8">
      <div className="bg-white rounded-3xl shadow-sm border border-[#E7E5E4] p-8">
        <h2 className="text-xl font-bold mb-6">Origem dos Dados</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={() => setDataSource('spreadsheet')}
            className={`p-6 rounded-3xl border-2 transition-all text-left ${
              dataSource === 'spreadsheet' 
                ? 'border-emerald-500 bg-emerald-50' 
                : 'border-[#E7E5E4] hover:border-[#D6D3D1]'
            }`}
          >
            <FileUp className={`mb-3 ${dataSource === 'spreadsheet' ? 'text-emerald-500' : 'text-[#A8A29E]'}`} size={24} />
            <h3 className="font-bold mb-1">Planilha (CSV/Excel)</h3>
            <p className="text-xs text-[#78716C]">Upload manual de listas de clientes e histórico de compras.</p>
          </button>
          <button 
            onClick={() => setDataSource('erp')}
            className={`p-6 rounded-3xl border-2 transition-all text-left ${
              dataSource === 'erp' 
                ? 'border-emerald-500 bg-emerald-50' 
                : 'border-[#E7E5E4] hover:border-[#D6D3D1]'
            }`}
          >
            <Database className={`mb-3 ${dataSource === 'erp' ? 'text-emerald-500' : 'text-[#A8A29E]'}`} size={24} />
            <h3 className="font-bold mb-1">Integração ERP</h3>
            <p className="text-xs text-[#78716C]">Sincronização automática com o sistema de gestão da Lubritec.</p>
          </button>
        </div>
        {dataSource === 'erp' && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-6 p-4 bg-blue-50 rounded-2xl border border-blue-100"
          >
            <div className="flex gap-3">
              <AlertCircle className="text-blue-500 shrink-0" size={20} />
              <div>
                <h4 className="font-bold text-blue-800 text-sm">Configuração de ERP</h4>
                <p className="text-xs text-blue-700 leading-relaxed mt-1">
                  Para integrar com seu ERP, precisaremos das credenciais de API ou acesso ao banco de dados. Entre em contato com o suporte técnico.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-[#E7E5E4] p-8">
        <h2 className="text-xl font-bold mb-6">Conexão WhatsApp</h2>
        <div className="flex items-center gap-8">
          <div className="w-48 h-48 bg-[#F5F5F4] rounded-3xl border-2 border-dashed border-[#D6D3D1] flex items-center justify-center">
            <div className="text-center p-4">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm mx-auto mb-3 flex items-center justify-center">
                <AlertCircle size={24} className="text-[#A8A29E]" />
              </div>
              <p className="text-[10px] font-bold text-[#78716C] uppercase tracking-wider">Aguardando QR Code</p>
            </div>
          </div>
          <div className="flex-1 space-y-4">
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <h4 className="font-bold text-emerald-800 text-sm mb-1">Como conectar?</h4>
              <p className="text-xs text-emerald-700 leading-relaxed">
                Abra o WhatsApp no seu celular, vá em Aparelhos Conectados e escaneie o QR Code ao lado.
              </p>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#78716C] uppercase tracking-wider">API Key (Meta Cloud API)</label>
              <input 
                type="password" 
                placeholder="Insira sua chave de API..." 
                className="w-full px-4 py-3 bg-[#F5F5F4] border border-transparent rounded-2xl focus:bg-white focus:border-emerald-500 focus:outline-none transition-all"
              />
            </div>
            <button className="bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">
              Salvar Configurações
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-[#E7E5E4] p-8">
        <h2 className="text-xl font-bold mb-6">Horário de Funcionamento</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#78716C] uppercase tracking-wide mb-2">Início</label>
            <input type="time" defaultValue="08:00" className="w-full px-4 py-3 bg-[#F5F5F4] rounded-2xl focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#78716C] uppercase tracking-wide mb-2">Término</label>
            <input type="time" defaultValue="18:00" className="w-full px-4 py-3 bg-[#F5F5F4] rounded-2xl focus:outline-none" />
          </div>
        </div>
        <p className="text-xs text-[#78716C] mt-4">
          Os disparos serão pausados automaticamente fora deste intervalo para evitar denúncias.
        </p>
      </div>
    </div>
  );
}
