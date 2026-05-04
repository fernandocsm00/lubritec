import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  inviteUser,
  listUsers,
  updateUser,
  resendInvite,
  deleteUserById,
  deleteInviteTokenById,
} from '../services/usersService';
import { sendInviteEmail } from '../lib/mailer';
import { HttpError } from '../middleware/errorHandler';
import { ROLES } from '../../shared/types';
import type { AuthedRequest } from '../middleware/authGuard';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(ROLES),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    role: z.enum(ROLES).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function inviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = inviteSchema.parse(req.body);
    const result = await inviteUser(body);
    try {
      await sendInviteEmail(body.email, body.name, result.tokenId, result.rawToken);
    } catch (mailErr) {
      // Compensating rollback: invite was inserted but the email failed,
      // which would leave a ghost user with no password. Delete and surface
      // a typed error so the admin sees something better than 500.
      console.error('[invite] sendInviteEmail failed, rolling back user', mailErr);
      await deleteUserById(result.user.id).catch((cleanupErr) => {
        console.error('[invite] compensating delete also failed', cleanupErr);
      });
      throw new HttpError(
        502,
        'Invite created but email could not be sent. Check SMTP settings and try again.',
        'EMAIL_SEND_FAILED',
      );
    }
    res.status(201).json({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
    });
  } catch (e) {
    next(e);
  }
}

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const list = await listUsers();
    res.json({ users: list });
  } catch (e) {
    next(e);
  }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = userIdParamsSchema.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    const updated = await updateUser({
      id,
      actorId: (req as AuthedRequest).user.userId,
      name: body.name,
      role: body.role,
      is_active: body.is_active,
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
}

export async function resendInviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = userIdParamsSchema.parse(req.params);
    const result = await resendInvite(id);
    try {
      await sendInviteEmail(result.user.email, result.user.name, result.tokenId, result.rawToken);
    } catch (mailErr) {
      // The user already existed; only the freshly-issued invite token is new.
      // Drop it so the next resend attempt starts clean.
      console.error('[resend-invite] sendInviteEmail failed, removing fresh token', mailErr);
      await deleteInviteTokenById(result.tokenId).catch((cleanupErr) => {
        console.error('[resend-invite] compensating delete also failed', cleanupErr);
      });
      throw new HttpError(
        502,
        'Invite re-issued but email could not be sent. Check SMTP settings and try again.',
        'EMAIL_SEND_FAILED',
      );
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
