/** Meeting records that share a body, date and kind (minutes, agenda, packet): the copies to fold into one. Agenda-item attachments are not copies. */
export const MEETING_COPY_GROUPS_SQL = `SELECT document_type AS t, document_date AS dt, government_body_id AS b, (CASE WHEN lower(title) LIKE '%special%' THEN 1 ELSE 0 END) AS sp,
              json_group_array(json_object('id', id, 'src', source_id, 'seen', first_seen_at, 'shard', search_shard)) AS docs
       FROM documents WHERE document_type IN ('minutes','agenda','agenda_packet') AND document_date IS NOT NULL AND government_body_id IS NOT NULL
         AND title NOT LIKE '%, 20__-__-__)' AND title NOT LIKE '%, 20__-__-__, item %)'
       GROUP BY t, dt, b, sp HAVING count(*) > 1 LIMIT 2000`;
