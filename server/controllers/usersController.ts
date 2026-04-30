import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { inviteUser } from '../services/usersService';
import { sendInviteEmail } from '../lib/mailer';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'comercial', 'recepcao']),
});

export async function inviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = inviteSchema.parse(req.body);
    const result = await inviteUser(body);
    await sendInviteEmail(body.email, body.name, result.tokenId, result.rawToken);
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
