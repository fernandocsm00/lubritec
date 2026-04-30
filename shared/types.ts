export type Role = 'admin' | 'comercial' | 'recepcao';

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

export interface ApiError {
  error: string;
  code?: string;
}
