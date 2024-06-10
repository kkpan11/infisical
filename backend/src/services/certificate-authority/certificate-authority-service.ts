/* eslint-disable no-bitwise */
import { ForbiddenError } from "@casl/ability";
import * as x509 from "@peculiar/x509";
import crypto, { KeyObject } from "crypto";

import { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { ProjectPermissionActions, ProjectPermissionSub } from "@app/ee/services/permission/project-permission";
import { BadRequestError } from "@app/lib/errors";
import { TCertificateCertDALFactory } from "@app/services/certificate/certificate-cert-dal";
import { TCertificateDALFactory } from "@app/services/certificate/certificate-dal";
import { TKmsServiceFactory } from "@app/services/kms/kms-service";
import { TProjectDALFactory } from "@app/services/project/project-dal";
import { getProjectKmsCertificateKeyId } from "@app/services/project/project-fns";

import { CertKeyAlgorithm, CertStatus } from "../certificate/certificate-types";
import { TCertificateAuthorityCertDALFactory } from "./certificate-authority-cert-dal";
import { TCertificateAuthorityCrlDALFactory } from "./certificate-authority-crl-dal";
import { TCertificateAuthorityDALFactory } from "./certificate-authority-dal";
import { createDistinguishedName, keyAlgorithmToAlgCfg } from "./certificate-authority-fns";
import { TCertificateAuthorityQueueFactory } from "./certificate-authority-queue";
import { TCertificateAuthoritySecretDALFactory } from "./certificate-authority-secret-dal";
import {
  CaStatus,
  CaType,
  TCreateCaDTO,
  TDeleteCaDTO,
  TGetCaCertDTO,
  TGetCaCsrDTO,
  TGetCaDTO,
  TGetCrl,
  TImportCertToCaDTO,
  TIssueCertFromCaDTO,
  // TRotateCrlDTO,
  TSignIntermediateDTO,
  TUpdateCaDTO
} from "./certificate-authority-types";

type TCertificateAuthorityServiceFactoryDep = {
  certificateAuthorityDAL: Pick<
    TCertificateAuthorityDALFactory,
    "transaction" | "create" | "findById" | "updateById" | "deleteById" | "findOne"
  >;
  certificateAuthorityCertDAL: Pick<TCertificateAuthorityCertDALFactory, "create" | "findOne" | "transaction">;
  certificateAuthoritySecretDAL: Pick<TCertificateAuthoritySecretDALFactory, "create" | "findOne">;
  certificateAuthorityCrlDAL: Pick<TCertificateAuthorityCrlDALFactory, "create" | "findOne" | "update">;
  certificateAuthorityQueue: TCertificateAuthorityQueueFactory; // TODO: Pick
  certificateDAL: Pick<TCertificateDALFactory, "transaction" | "create" | "find">;
  certificateCertDAL: Pick<TCertificateCertDALFactory, "create">;
  projectDAL: Pick<TProjectDALFactory, "findProjectBySlug" | "findOne" | "updateById" | "findById" | "transaction">;
  kmsService: Pick<TKmsServiceFactory, "generateKmsKey" | "encrypt" | "decrypt">;
  permissionService: Pick<TPermissionServiceFactory, "getProjectPermission">;
};

export type TCertificateAuthorityServiceFactory = ReturnType<typeof certificateAuthorityServiceFactory>;

export const certificateAuthorityServiceFactory = ({
  certificateAuthorityDAL,
  certificateAuthorityCertDAL,
  certificateAuthoritySecretDAL,
  certificateAuthorityCrlDAL,
  certificateDAL,
  certificateCertDAL,
  projectDAL,
  kmsService,
  permissionService
}: TCertificateAuthorityServiceFactoryDep) => {
  /**
   * Generates a new root or intermediate CA
   */
  const createCa = async ({
    projectSlug,
    type,
    commonName,
    organization,
    ou,
    country,
    province,
    locality,
    notBefore,
    notAfter,
    maxPathLength,
    keyAlgorithm,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TCreateCaDTO) => {
    const project = await projectDAL.findProjectBySlug(projectSlug, actorOrgId);
    if (!project) throw new BadRequestError({ message: "Project not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      ProjectPermissionSub.CertificateAuthorities
    );

    const dn = createDistinguishedName({
      commonName,
      organization,
      ou,
      country,
      province,
      locality
    });

    const alg = keyAlgorithmToAlgCfg(keyAlgorithm);
    const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);

    const newCa = await certificateAuthorityDAL.transaction(async (tx) => {
      const notBeforeDate = notBefore ? new Date(notBefore) : new Date();

      // if undefined, set [notAfterDate] to 10 years from now
      const notAfterDate = notAfter
        ? new Date(notAfter)
        : new Date(new Date().setFullYear(new Date().getFullYear() + 10));

      const serialNumber = crypto.randomBytes(32).toString("hex");
      const ca = await certificateAuthorityDAL.create(
        {
          projectId: project.id,
          type,
          organization,
          ou,
          country,
          province,
          locality,
          commonName,
          status: type === CaType.ROOT ? CaStatus.ACTIVE : CaStatus.PENDING_CERTIFICATE,
          dn,
          keyAlgorithm,
          ...(type === CaType.ROOT && {
            maxPathLength,
            notBefore: notBeforeDate,
            notAfter: notAfterDate,
            serialNumber
          })
        },
        tx
      );

      const keyId = await getProjectKmsCertificateKeyId({
        projectId: project.id,
        projectDAL,
        kmsService
      });

      if (type === CaType.ROOT) {
        // note: create self-signed cert only applicable for root CA
        const cert = await x509.X509CertificateGenerator.createSelfSigned({
          name: dn,
          serialNumber,
          notBefore: notBeforeDate,
          notAfter: notAfterDate,
          signingAlgorithm: alg,
          keys,
          extensions: [
            new x509.BasicConstraintsExtension(true, maxPathLength === -1 ? undefined : maxPathLength, true),
            new x509.ExtendedKeyUsageExtension(["1.2.3.4.5.6.7", "2.3.4.5.6.7.8"], true),
            // eslint-disable-next-line no-bitwise
            new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
            await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
          ]
        });

        const { cipherTextBlob: encryptedCertificate } = await kmsService.encrypt({
          kmsId: keyId,
          plainText: Buffer.from(new Uint8Array(cert.rawData))
        });

        const { cipherTextBlob: encryptedCertificateChain } = await kmsService.encrypt({
          kmsId: keyId,
          plainText: Buffer.alloc(0)
        });

        await certificateAuthorityCertDAL.create(
          {
            caId: ca.id,
            encryptedCertificate,
            encryptedCertificateChain
          },
          tx
        );
      }

      // create empty CRL
      const crl = await x509.X509CrlGenerator.create({
        issuer: ca.dn,
        thisUpdate: new Date(),
        nextUpdate: new Date("2025/12/12"), // TODO: change
        entries: [],
        signingAlgorithm: alg,
        signingKey: keys.privateKey
      });

      const { cipherTextBlob: encryptedCrl } = await kmsService.encrypt({
        kmsId: keyId,
        plainText: Buffer.from(new Uint8Array(crl.rawData))
      });

      await certificateAuthorityCrlDAL.create(
        {
          caId: ca.id,
          encryptedCrl
        },
        tx
      );

      // https://nodejs.org/api/crypto.html#static-method-keyobjectfromkey
      const skObj = KeyObject.from(keys.privateKey);

      const { cipherTextBlob: encryptedPrivateKey } = await kmsService.encrypt({
        kmsId: keyId,
        plainText: skObj.export({
          type: "pkcs8",
          format: "der"
        })
      });

      await certificateAuthoritySecretDAL.create(
        {
          caId: ca.id,
          encryptedPrivateKey
        },
        tx
      );

      return ca;
    });

    return newCa;
  };

  const getCaById = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TGetCaDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Read,
      ProjectPermissionSub.CertificateAuthorities
    );

    return ca;
  };

  const updateCaById = async ({ caId, status, actorId, actorAuthMethod, actor, actorOrgId }: TUpdateCaDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      ProjectPermissionSub.CertificateAuthorities
    );

    const updatedCa = await certificateAuthorityDAL.updateById(caId, { status });

    return updatedCa;
  };

  const deleteCaById = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TDeleteCaDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Delete,
      ProjectPermissionSub.CertificateAuthorities
    );

    const deletedCa = await certificateAuthorityDAL.deleteById(caId);

    return deletedCa;
  };

  /**
   * Generates a CSR for a CA
   */
  const getCaCsr = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TGetCaCsrDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      ProjectPermissionSub.CertificateAuthorities
    );

    if (ca.type === CaType.ROOT) throw new BadRequestError({ message: "Root CA cannot generate CSR" });

    const caCert = await certificateAuthorityCertDAL.findOne({ caId: ca.id });
    if (caCert) throw new BadRequestError({ message: "CA already has a certificate installed" });

    const caSecret = await certificateAuthoritySecretDAL.findOne({ caId: ca.id });

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const privateKey = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caSecret.encryptedPrivateKey
    });

    const alg = keyAlgorithmToAlgCfg(ca.keyAlgorithm as CertKeyAlgorithm);
    const skObj = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
    const sk = await crypto.subtle.importKey("pkcs8", skObj.export({ format: "der", type: "pkcs8" }), alg, true, [
      "sign"
    ]);
    const pkObj = crypto.createPublicKey(skObj);

    const pk = await crypto.subtle.importKey("spki", pkObj.export({ format: "der", type: "spki" }), alg, true, [
      "verify"
    ]);

    const csrObj = await x509.Pkcs10CertificateRequestGenerator.create({
      name: ca.dn,
      keys: { privateKey: sk, publicKey: pk },
      signingAlgorithm: alg,
      extensions: [
        // eslint-disable-next-line no-bitwise
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign |
            x509.KeyUsageFlags.cRLSign |
            x509.KeyUsageFlags.digitalSignature |
            x509.KeyUsageFlags.keyEncipherment
        )
      ],
      attributes: [new x509.ChallengePasswordAttribute("password")]
    });

    return csrObj.toString("pem");
  };

  /**
   * Return certificate and certificate chain for CA
   */
  const getCaCert = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TGetCaCertDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Read,
      ProjectPermissionSub.CertificateAuthorities
    );

    const caCert = await certificateAuthorityCertDAL.findOne({ caId: ca.id });

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const decryptedCaCert = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificate
    });

    const certObj = new x509.X509Certificate(decryptedCaCert);

    const decryptedChain = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificateChain
    });

    return {
      certificate: certObj.toString("pem"),
      certificateChain: decryptedChain.toString("utf-8"),
      serialNumber: certObj.serialNumber
    };
  };

  /**
   * Issue certificate to be imported back in for intermediate CA
   */
  const signIntermediate = async ({
    caId,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId,
    csr,
    notBefore,
    notAfter,
    maxPathLength
  }: TSignIntermediateDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      ProjectPermissionSub.CertificateAuthorities
    );

    if (ca.status === CaStatus.DISABLED) throw new BadRequestError({ message: "CA is disabled" });

    const alg = keyAlgorithmToAlgCfg(ca.keyAlgorithm as CertKeyAlgorithm);

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const caCert = await certificateAuthorityCertDAL.findOne({ caId: ca.id });
    const caSecret = await certificateAuthoritySecretDAL.findOne({ caId: ca.id });

    const privateKey = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caSecret.encryptedPrivateKey
    });

    const skObj = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
    const sk = await crypto.subtle.importKey("pkcs8", skObj.export({ format: "der", type: "pkcs8" }), alg, true, [
      "sign"
    ]);

    const decryptedCaCert = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificate
    });

    const caCertObj = new x509.X509Certificate(decryptedCaCert);
    const csrObj = new x509.Pkcs10CertificateRequest(csr);

    // check path length constraint
    const caPathLength = caCertObj.getExtension(x509.BasicConstraintsExtension)?.pathLength;
    if (caPathLength !== undefined) {
      if (caPathLength === 0)
        throw new BadRequestError({
          message: "Failed to issue intermediate certificate due to CA path length constraint"
        });
      if (maxPathLength >= caPathLength || (maxPathLength === -1 && caPathLength !== -1))
        throw new BadRequestError({
          message: "The requested path length constraint exceeds the CA's allowed path length"
        });
    }

    const notBeforeDate = notBefore ? new Date(notBefore) : new Date();
    const notAfterDate = new Date(notAfter);

    const caCertNotBeforeDate = new Date(caCertObj.notBefore);
    const caCertNotAfterDate = new Date(caCertObj.notAfter);

    // check not before constraint
    if (notBeforeDate < caCertNotBeforeDate) {
      throw new BadRequestError({ message: "notBefore date is before CA certificate's notBefore date" });
    }

    if (notBeforeDate > notAfterDate) throw new BadRequestError({ message: "notBefore date is after notAfter date" });

    // check not after constraint
    if (notAfterDate > caCertNotAfterDate) {
      throw new BadRequestError({ message: "notAfter date is after CA certificate's notAfter date" });
    }

    const serialNumber = crypto.randomBytes(32).toString("hex");
    const intermediateCert = await x509.X509CertificateGenerator.create({
      serialNumber,
      subject: csrObj.subject,
      issuer: caCertObj.subject,
      notBefore: notBeforeDate,
      notAfter: notAfterDate,
      signingKey: sk,
      publicKey: csrObj.publicKey,
      signingAlgorithm: alg,
      extensions: [
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign |
            x509.KeyUsageFlags.cRLSign |
            x509.KeyUsageFlags.digitalSignature |
            x509.KeyUsageFlags.keyEncipherment,
          true
        ),
        new x509.BasicConstraintsExtension(true, maxPathLength === -1 ? undefined : maxPathLength, true),
        await x509.AuthorityKeyIdentifierExtension.create(caCertObj, false),
        await x509.SubjectKeyIdentifierExtension.create(csrObj.publicKey)
      ]
    });

    const caCertChain = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificateChain
    });

    const certificateChain = `${caCertObj.toString("pem")}\n${caCertChain.toString("utf-8")}`.trim();

    return {
      certificate: intermediateCert.toString("pem"),
      issuingCaCertificate: caCertObj.toString("pem"),
      certificateChain,
      serialNumber: intermediateCert.serialNumber
    };
  };

  const importCertToCa = async ({
    caId,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId,
    certificate,
    certificateChain
  }: TImportCertToCaDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      ProjectPermissionSub.CertificateAuthorities
    );

    const caCert = await certificateAuthorityCertDAL.findOne({ caId: ca.id });
    if (caCert) throw new BadRequestError({ message: "CA has already imported a certificate" });

    const certObj = new x509.X509Certificate(certificate);
    const maxPathLength = certObj.getExtension(x509.BasicConstraintsExtension)?.pathLength;

    // validate imported certificate and certificate chain
    const certificates = certificateChain
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
      ?.map((cert) => new x509.X509Certificate(cert));

    if (!certificates) throw new BadRequestError({ message: "Failed to parse certificate chain" });

    const chain = new x509.X509ChainBuilder({
      certificates
    });

    const chainItems = await chain.build(certObj);

    // chain.build() implicitly verifies the chain
    if (chainItems.length !== certificates.length + 1)
      throw new BadRequestError({ message: "Invalid certificate chain" });

    const parentCertObj = chainItems[1];
    const parentCertSubject = parentCertObj.subject;

    const parentCa = await certificateAuthorityDAL.findOne({
      projectId: ca.projectId,
      dn: parentCertSubject
    });

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const { cipherTextBlob: encryptedCertificate } = await kmsService.encrypt({
      kmsId: keyId,
      plainText: Buffer.from(new Uint8Array(certObj.rawData))
    });

    const { cipherTextBlob: encryptedCertificateChain } = await kmsService.encrypt({
      kmsId: keyId,
      plainText: Buffer.from(certificateChain)
    });

    await certificateAuthorityCertDAL.transaction(async (tx) => {
      await certificateAuthorityCertDAL.create(
        {
          caId: ca.id,
          encryptedCertificate,
          encryptedCertificateChain
        },
        tx
      );

      await certificateAuthorityDAL.updateById(
        ca.id,
        {
          status: CaStatus.ACTIVE,
          maxPathLength: maxPathLength === undefined ? -1 : maxPathLength,
          notBefore: new Date(certObj.notBefore),
          notAfter: new Date(certObj.notAfter),
          serialNumber: certObj.serialNumber,
          parentCaId: parentCa?.id
        },
        tx
      );
    });
  };

  const issueCertFromCa = async ({
    caId,
    commonName,
    ttl,
    notBefore,
    notAfter,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TIssueCertFromCaDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Create, ProjectPermissionSub.Certificates);

    if (ca.status === CaStatus.DISABLED) throw new BadRequestError({ message: "CA is disabled" });

    const caCert = await certificateAuthorityCertDAL.findOne({ caId: ca.id });
    if (!caCert) throw new BadRequestError({ message: "CA does not have a certificate installed" });

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const decryptedCaCert = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificate
    });

    const caCertObj = new x509.X509Certificate(decryptedCaCert);

    const caSecret = await certificateAuthoritySecretDAL.findOne({ caId: ca.id });

    const privateKey = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caSecret.encryptedPrivateKey
    });

    const alg = keyAlgorithmToAlgCfg(ca.keyAlgorithm as CertKeyAlgorithm);

    const caSkObj = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
    const caSk = await crypto.subtle.importKey("pkcs8", caSkObj.export({ format: "der", type: "pkcs8" }), alg, true, [
      "sign"
    ]);

    const leafKeys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);

    const csrObj = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${commonName}`,
      keys: leafKeys,
      signingAlgorithm: alg,
      extensions: [
        // eslint-disable-next-line no-bitwise
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment)
      ],
      attributes: [new x509.ChallengePasswordAttribute("password")]
    });

    const notBeforeDate = notBefore ? new Date(notBefore) : new Date();

    let notAfterDate = new Date(new Date().setFullYear(new Date().getFullYear() + 1));
    if (notAfter) {
      notAfterDate = new Date(notAfter);
    } else if (ttl) {
      // ttl in seconds
      notAfterDate = new Date(new Date().getTime() + ttl * 1000);
    }

    const caCertNotBeforeDate = new Date(caCertObj.notBefore);
    const caCertNotAfterDate = new Date(caCertObj.notAfter);

    // check not before constraint
    if (notBeforeDate < caCertNotBeforeDate) {
      throw new BadRequestError({ message: "notBefore date is before CA certificate's notBefore date" });
    }

    if (notBeforeDate > notAfterDate) throw new BadRequestError({ message: "notBefore date is after notAfter date" });

    // check not after constraint
    if (notAfterDate > caCertNotAfterDate) {
      throw new BadRequestError({ message: "notAfter date is after CA certificate's notAfter date" });
    }

    const serialNumber = crypto.randomBytes(32).toString("hex");
    const leafCert = await x509.X509CertificateGenerator.create({
      serialNumber,
      subject: csrObj.subject,
      issuer: caCertObj.subject,
      notBefore: notBeforeDate,
      notAfter: notAfterDate,
      signingKey: caSk,
      publicKey: csrObj.publicKey,
      signingAlgorithm: alg,
      extensions: [
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
        new x509.BasicConstraintsExtension(false),
        await x509.AuthorityKeyIdentifierExtension.create(caCertObj, false),
        await x509.SubjectKeyIdentifierExtension.create(csrObj.publicKey)
      ]
    });

    const skLeafObj = KeyObject.from(leafKeys.privateKey);
    const skLeaf = skLeafObj.export({ format: "pem", type: "pkcs8" }) as string;

    const { cipherTextBlob: encryptedCertificate } = await kmsService.encrypt({
      kmsId: keyId,
      plainText: Buffer.from(new Uint8Array(leafCert.rawData))
    });

    const caCertChain = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCert.encryptedCertificateChain
    });

    await certificateDAL.transaction(async (tx) => {
      const cert = await certificateDAL.create(
        {
          caId: ca.id,
          status: CertStatus.ACTIVE,
          commonName,
          serialNumber,
          notBefore: notBeforeDate,
          notAfter: notAfterDate
        },
        tx
      );

      await certificateCertDAL.create(
        {
          certId: cert.id,
          encryptedCertificate
        },
        tx
      );

      return cert;
    });

    const certificateChain = `${caCertObj.toString("pem")}\n${caCertChain.toString("utf-8")}`.trim();

    return {
      certificate: leafCert.toString("pem"),
      certificateChain,
      issuingCaCertificate: caCertObj.toString("pem"),
      privateKey: skLeaf,
      serialNumber
    };
  };

  /**
   * Return the Certificate Revocation List (CRL) for the CA
   */
  const getCaCrl = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TGetCrl) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) throw new BadRequestError({ message: "CA not found" });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Read,
      ProjectPermissionSub.CertificateAuthorities
    );

    const caCrl = await certificateAuthorityCrlDAL.findOne({ caId: ca.id });
    if (!caCrl) throw new BadRequestError({ message: "CRL not found" });

    const keyId = await getProjectKmsCertificateKeyId({
      projectId: ca.projectId,
      projectDAL,
      kmsService
    });

    const decryptedCrl = await kmsService.decrypt({
      kmsId: keyId,
      cipherTextBlob: caCrl.encryptedCrl
    });

    const crl = new x509.X509Crl(decryptedCrl);

    const base64crl = crl.toString("base64");
    const crlPem = `-----BEGIN X509 CRL-----\n${base64crl.match(/.{1,64}/g)?.join("\n")}\n-----END X509 CRL-----`;

    return {
      crl: crlPem
    };
  };

  // const rotateCaCrl = async ({ caId, actorId, actorAuthMethod, actor, actorOrgId }: TRotateCrlDTO) => {
  //   const ca = await certificateAuthorityDAL.findById(caId);
  //   if (!ca) throw new BadRequestError({ message: "CA not found" });

  //   const { permission } = await permissionService.getProjectPermission(
  //     actor,
  //     actorId,
  //     ca.projectId,
  //     actorAuthMethod,
  //     actorOrgId
  //   );

  //   ForbiddenError.from(permission).throwUnlessCan(
  //     ProjectPermissionActions.Read,
  //     ProjectPermissionSub.CertificateAuthorities
  //   );

  //   const caSecret = await certificateAuthoritySecretDAL.findOne({ caId: ca.id });

  //   const alg = keyAlgorithmToAlgCfg(ca.keyAlgorithm as CertKeyAlgorithm);

  //   const keyId = await getProjectKmsCertificateKeyId({
  //     projectId: ca.projectId,
  //     projectDAL,
  //     kmsService
  //   });

  //   const privateKey = await kmsService.decrypt({
  //     kmsId: keyId,
  //     cipherTextBlob: caSecret.encryptedPrivateKey
  //   });

  //   const skObj = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
  //   const sk = await crypto.subtle.importKey("pkcs8", skObj.export({ format: "der", type: "pkcs8" }), alg, true, [
  //     "sign"
  //   ]);

  //   const revokedCerts = await certificateDAL.find({
  //     caId: ca.id,
  //     status: CertStatus.REVOKED
  //   });

  //   const crl = await x509.X509CrlGenerator.create({
  //     issuer: ca.dn,
  //     thisUpdate: new Date(),
  //     nextUpdate: new Date("2025/12/12"),
  //     entries: revokedCerts.map((revokedCert) => {
  //       return {
  //         serialNumber: revokedCert.serialNumber,
  //         revocationDate: new Date(revokedCert.revokedAt as Date),
  //         reason: revokedCert.revocationReason as number,
  //         invalidity: new Date("2022/01/01"),
  //         issuer: ca.dn
  //       };
  //     }),
  //     signingAlgorithm: alg,
  //     signingKey: sk
  //   });

  //   const { cipherTextBlob: encryptedCrl } = await kmsService.encrypt({
  //     kmsId: keyId,
  //     plainText: Buffer.from(new Uint8Array(crl.rawData))
  //   });

  //   await certificateAuthorityCrlDAL.update(
  //     {
  //       caId: ca.id
  //     },
  //     {
  //       encryptedCrl
  //     }
  //   );

  //   const base64crl = crl.toString("base64");
  //   const crlPem = `-----BEGIN X509 CRL-----\n${base64crl.match(/.{1,64}/g)?.join("\n")}\n-----END X509 CRL-----`;

  //   return {
  //     crl: crlPem
  //   };
  // };

  return {
    createCa,
    getCaById,
    updateCaById,
    deleteCaById,
    getCaCsr,
    getCaCert,
    signIntermediate,
    importCertToCa,
    issueCertFromCa,
    getCaCrl
    // rotateCaCrl
  };
};
