import ms from "ms";
import { z } from "zod";

import { EventType } from "@app/ee/services/audit-log/audit-log-types";
import { SshCertType } from "@app/ee/services/ssh/ssh-certificate-authority-types";
import { SSH_CERTIFICATE_AUTHORITIES } from "@app/lib/api-docs";
import { writeLimit } from "@app/server/config/rateLimiter";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";
import { CertKeyAlgorithm } from "@app/services/certificate/certificate-types";

export const registerSshRouter = async (server: FastifyZodProvider) => {
  server.route({
    method: "POST",
    url: "/sign",
    config: {
      rateLimit: writeLimit
    },
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      description: "Sign SSH public key",
      body: z.object({
        projectId: z.string().trim().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.projectId),
        templateName: z.string().trim().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.templateName),
        publicKey: z.string().trim().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.publicKey),
        certType: z
          .nativeEnum(SshCertType)
          .default(SshCertType.USER)
          .describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.certType),
        principals: z
          .array(z.string().transform((val) => val.trim()))
          .nonempty("Principals array must not be empty")
          .describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.principals),
        ttl: z
          .string()
          .refine((val) => ms(val) > 0, "TTL must be a positive number")
          .optional()
          .describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.ttl),
        keyId: z.string().trim().optional().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.keyId)
      }),
      response: {
        200: z.object({
          serialNumber: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.serialNumber),
          signedKey: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.SIGN_SSH_KEY.signedKey)
        })
      }
    },
    handler: async (req) => {
      const { serialNumber, signedPublicKey, certificateTemplate, ttl, keyId } =
        await server.services.sshCertificateAuthority.signSshKey({
          actor: req.permission.type,
          actorId: req.permission.id,
          actorAuthMethod: req.permission.authMethod,
          actorOrgId: req.permission.orgId,
          ...req.body
        });

      await server.services.auditLog.createAuditLog({
        ...req.auditLogInfo,
        orgId: req.permission.orgId,
        event: {
          type: EventType.SIGN_SSH_KEY,
          metadata: {
            certificateTemplateId: certificateTemplate.id,
            certType: req.body.certType,
            principals: req.body.principals,
            ttl: String(ttl),
            keyId
          }
        }
      });

      return {
        serialNumber,
        signedKey: signedPublicKey
      };
    }
  });

  server.route({
    method: "POST",
    url: "/issue",
    config: {
      rateLimit: writeLimit
    },
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      description: "Issue SSH credentials (certificate + key)",
      body: z.object({
        projectId: z.string().trim().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.projectId),
        templateName: z.string().trim().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.templateName),
        keyAlgorithm: z
          .nativeEnum(CertKeyAlgorithm)
          .default(CertKeyAlgorithm.RSA_2048)
          .describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.keyAlgorithm),
        certType: z
          .nativeEnum(SshCertType)
          .default(SshCertType.USER)
          .describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.certType),
        principals: z
          .array(z.string().transform((val) => val.trim()))
          .nonempty("Principals array must not be empty")
          .describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.principals),
        ttl: z
          .string()
          .refine((val) => ms(val) > 0, "TTL must be a positive number")
          .optional()
          .describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.ttl),
        keyId: z.string().trim().optional()
      }),
      response: {
        200: z.object({
          serialNumber: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.serialNumber),
          signedKey: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.signedKey),
          privateKey: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.privateKey),
          publicKey: z.string().describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.publicKey),
          keyAlgorithm: z
            .nativeEnum(CertKeyAlgorithm)
            .describe(SSH_CERTIFICATE_AUTHORITIES.ISSUE_SSH_CREDENTIALS.keyAlgorithm)
        })
      }
    },
    handler: async (req) => {
      const { serialNumber, signedPublicKey, privateKey, publicKey, certificateTemplate, ttl, keyId } =
        await server.services.sshCertificateAuthority.issueSshCreds({
          actor: req.permission.type,
          actorId: req.permission.id,
          actorAuthMethod: req.permission.authMethod,
          actorOrgId: req.permission.orgId,
          ...req.body
        });

      await server.services.auditLog.createAuditLog({
        ...req.auditLogInfo,
        orgId: req.permission.orgId,
        event: {
          type: EventType.ISSUE_SSH_CREDS,
          metadata: {
            certificateTemplateId: certificateTemplate.id,
            keyAlgorithm: req.body.keyAlgorithm,
            certType: req.body.certType,
            principals: req.body.principals,
            ttl: String(ttl),
            keyId
          }
        }
      });

      return {
        serialNumber,
        signedKey: signedPublicKey,
        privateKey,
        publicKey,
        keyAlgorithm: req.body.keyAlgorithm
      };
    }
  });
};
