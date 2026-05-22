import { Navigate, type RouteObject } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { AdminRoute } from '@/features/auth/AdminRoute';
import { AppShell } from '@/components/layout/AppShell';

const Login = lazy(() => import('@/pages/login/Login'));
const SetupPassword = lazy(() => import('@/pages/auth-setup/SetupPassword'));
const ResetPassword = lazy(() => import('@/pages/auth-reset/ResetPassword'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const DashboardDetailsPage = lazy(() => import('@/pages/dashboard/DashboardDetailsPage'));
const WhatsappPage = lazy(() => import('@/pages/whatsapp/WhatsappPage'));
const InsideSalesPage = lazy(() => import('@/pages/inside-sales/InsideSalesPage'));
const CampaignsPage = lazy(() => import('@/pages/campaigns/CampaignsPage'));
const CampaignNewPage = lazy(() => import('@/pages/campaigns/CampaignNewPage'));
const CampaignDetailPage = lazy(() => import('@/pages/campaigns/CampaignDetailPage'));
const ContinuousCampaignPage = lazy(() => import('@/pages/campaigns/ContinuousCampaignPage'));
const CampaignsReportPage = lazy(() => import('@/pages/campaigns/CampaignsReportPage'));
const CadastrosPage = lazy(() => import('@/pages/cadastros/CadastrosPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ProjetoPage = lazy(() => import('@/pages/projeto/ProjetoPage'));
const NotFound = lazy(() => import('@/pages/NotFound'));

const Loader = () => <div className="p-6 text-muted-foreground">Carregando…</div>;
const wrap = (el: ReactElement) => <Suspense fallback={<Loader />}>{el}</Suspense>;

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '/login', element: wrap(<Login />) },
  { path: '/auth/setup', element: wrap(<SetupPassword />) },
  { path: '/auth/reset', element: wrap(<ResetPassword />) },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: wrap(<DashboardPage />) },
          { path: '/dashboard/detalhes', element: wrap(<DashboardDetailsPage />) },
          { path: '/whatsapp', element: wrap(<WhatsappPage />) },
          { path: '/inside-sales', element: wrap(<InsideSalesPage />) },
          { path: '/campanhas', element: wrap(<CampaignsPage />) },
          { path: '/campanhas/relatorio', element: wrap(<CampaignsReportPage />) },
          { path: '/campanhas/automatico', element: wrap(<ContinuousCampaignPage />) },
          { path: '/campanhas/nova', element: wrap(<CampaignNewPage />) },
          { path: '/campanhas/:id', element: wrap(<CampaignDetailPage />) },
          { path: '/cadastros', element: wrap(<CadastrosPage />) },
          { path: '/projeto', element: wrap(<ProjetoPage />) },
          { path: '/settings', element: wrap(<SettingsPage />) },
          {
            element: <AdminRoute />,
            children: [{ path: '/admin', element: wrap(<AdminPage />) }],
          },
        ],
      },
    ],
  },
  { path: '*', element: wrap(<NotFound />) },
];
