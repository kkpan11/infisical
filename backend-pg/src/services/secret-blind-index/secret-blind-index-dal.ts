import { Knex } from "knex";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { DatabaseError } from "@app/lib/errors";
import { ormify, selectAllTableCols } from "@app/lib/knex";

export type TSecretBlindIndexDALFactory = ReturnType<typeof secretBlindIndexDALFactory>;

export const secretBlindIndexDALFactory = (db: TDbClient) => {
  const secretBlindIndexOrm = ormify(db, TableName.SecretBlindIndex);

  const countOfSecretsWithNullSecretBlindIndex = async (projectId: string, tx?: Knex) => {
    try {
      const doc = await (tx || db)(TableName.Secret)
        .leftJoin(
          TableName.SecretFolder,
          `${TableName.SecretFolder}.id`,
          `${TableName.Secret}.folderId`
        )
        .leftJoin(
          TableName.Environment,
          `${TableName.Environment}.id`,
          `${TableName.SecretFolder}.envId`
        )
        .where({ projectId })
        .whereNull("secretBlindIndex")
        .count(`${TableName.Secret}.id`);
      return (doc as any)?.[0]?.count || 0;
    } catch (error) {
      throw new DatabaseError({ error, name: "CountOfSecretWillNullSecretBlindIndex" });
    }
  };

  const findAllSecretsByProjectId = async (projectId: string, tx?: Knex) => {
    try {
      const docs = await (tx || db)(TableName.Secret)
        .leftJoin(
          TableName.SecretFolder,
          `${TableName.SecretFolder}.id`,
          `${TableName.Secret}.folderId`
        )
        .leftJoin(
          TableName.Environment,
          `${TableName.Environment}.id`,
          `${TableName.SecretFolder}.envId`
        )
        .where({ projectId })
        .whereNull("secretBlindIndex")
        .select(selectAllTableCols(TableName.Secret))
        .select(
          db.ref("slug").withSchema(TableName.Environment).as("environment"),
          db.ref("projectId").withSchema(TableName.Environment).as("workspace")
        );
      return docs;
    } catch (error) {
      throw new DatabaseError({ error, name: "CountOfSecretWillNullSecretBlindIndex" });
    }
  };

  return {
    ...secretBlindIndexOrm,
    countOfSecretsWithNullSecretBlindIndex,
    findAllSecretsByProjectId
  };
};
