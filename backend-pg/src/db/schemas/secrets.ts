// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const SecretsSchema = z.object({
  id: z.string().uuid(),
  version: z.number().default(1),
  type: z.string().default('shared'),
  secretBlindIndex: z.string(),
  secretKeyCiphertext: z.string(),
  secretKeyIV: z.string(),
  secretKeyTag: z.string(),
  secretValueCiphertext: z.string(),
  secretValueIV: z.string(),
  secretValueTag: z.string(),
  secretCommentCiphertext: z.string().nullable().optional(),
  secretCommentIV: z.string().nullable().optional(),
  secretCommentTag: z.string().nullable().optional(),
  secretReminderNote: z.string().nullable().optional(),
  secretReminderRepeatDays: z.number().nullable().optional(),
  skipMultilineEncoding: z.boolean().default(false).nullable().optional(),
  algorithm: z.string().default('aes-256-gcm'),
  keyEncoding: z.string().default('utf8'),
  metadata: z.unknown().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TSecrets = z.infer<typeof SecretsSchema>;
export type TSecretsInsert = Omit<TSecrets, TImmutableDBKeys>;
export type TSecretsUpdate = Partial<Omit<TSecrets, TImmutableDBKeys>>;
