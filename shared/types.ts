export const ROLES = ['admin', 'comercial', 'recepcao'] as const;
export type Role = (typeof ROLES)[number];

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  has_password: boolean;
}

export const LEAD_STATUSES = ['frio', 'morno', 'quente'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['manual', 'csv', 'whatsapp'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface PublicLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  lastPurchaseDate: string | null;
  avgMileagePerDay: number | null;
  status: LeadStatus;
  source: LeadSource;
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}
