UPDATE favorite_collections
SET name = name || ' (' || rn || ')'
FROM (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY lower(name) ORDER BY created_at, id
    ) AS rn
    FROM favorite_collections
) AS dupes
WHERE favorite_collections.id = dupes.id AND dupes.rn > 1;

CREATE UNIQUE INDEX idx_favorite_collections_name_nocase
    ON favorite_collections (name COLLATE NOCASE);
