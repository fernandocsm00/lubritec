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
