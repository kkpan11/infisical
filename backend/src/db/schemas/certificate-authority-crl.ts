// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { zodBuffer } from "@app/lib/zod";

import { TImmutableDBKeys } from "./models";

export const CertificateAuthorityCrlSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  caId: z.string().uuid(),
  encryptedCrl: zodBuffer
});

export type TCertificateAuthorityCrl = z.infer<typeof CertificateAuthorityCrlSchema>;
export type TCertificateAuthorityCrlInsert = Omit<z.input<typeof CertificateAuthorityCrlSchema>, TImmutableDBKeys>;
export type TCertificateAuthorityCrlUpdate = Partial<
  Omit<z.input<typeof CertificateAuthorityCrlSchema>, TImmutableDBKeys>
>;
