import { eraseLearningHistory } from './learning-deletion.mjs';

export async function deleteLicensingPerson(pool, store, id, version, baseIdForEmail) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id,email FROM amg_private.licensing_people WHERE id=$1 AND version=$2 FOR UPDATE', [id, version]);
    if (!rows.length) { await client.query('ROLLBACK'); return null; }
    const person = rows[0];
    if (person.email) await eraseLearningHistory(store, { email: person.email, baseUserId: await baseIdForEmail(person.email.normalize('NFKC').trim().toLowerCase()), deletionId: id });
    const deleted = await client.query('DELETE FROM amg_private.licensing_people WHERE id=$1 AND version=$2 RETURNING id', [id, version]);
    if (deleted.rows.length !== 1) throw new Error('Licensing record changed');
    await client.query('COMMIT');
    return deleted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
