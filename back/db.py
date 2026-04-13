import json

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session

with open('config.json', 'r') as f:
    config = json.load(f)

engine = create_engine(
    f"postgresql://{config['DB_USER']}:{config['DB_PASSWORD']}@{config['DB_HOST']}:{config['DB_PORT']}/{config['DB_NAME']}",
    pool_pre_ping=True
)
session_factory = sessionmaker(bind=engine)
Session = scoped_session(session_factory)


def stop_pool():
    engine.dispose()
    print("PostgreSQL pool closed.")


def select_brancher_data(start, end, min_sons, size, t_window, min_hex, min_hex_son, h3_list=None, parent_snp=None):
    with Session() as session:
        sql = """
            SELECT 
                t.snp, 
                s.centroids, 
                cardinality(s.centroids) as hex_count,
                (
                    SELECT COUNT(*) 
                    FROM tmrcas t_sons 
                    JOIN snps3 s_sons ON t_sons.snp = s_sons.snp AND s_sons.size = :size
                    WHERE t_sons.snp = ANY(c.childs) 
                      AND t_sons.tmrca >= t.tmrca
                      AND t_sons.tmrca <= LEAST(t.tmrca + :t_window, :end)
                      AND cardinality(s_sons.centroids) >= :min_hex_son
                ) as window_sons
            FROM tmrcas t
            JOIN childs c ON t.snp = c.snp
            INNER JOIN snps3 s ON t.snp = s.snp AND s.size = :size
            WHERE t.tmrca BETWEEN :start AND :end
        """

        params = {
            "start": start,
            "end": end,
            "min_sons": int(min_sons),
            "size": str(size),
            "t_window": int(t_window),
            "min_hex": int(min_hex),
            "min_hex_son": int(min_hex_son)
        }

        if parent_snp:
            sql += """ AND t.snp IN (
                WITH RECURSIVE family_tree AS (
                    SELECT snp as root_name FROM synonyms WHERE :parent_snp = ANY(synonyms) LIMIT 1
                ),
                descendants AS (
                    SELECT root_name as node_name FROM family_tree
                    UNION ALL
                    SELECT unnest(c.childs) 
                    FROM childs c 
                    JOIN descendants d ON c.snp = d.node_name
                )
                SELECT node_name FROM descendants
            )"""
            params["parent_snp"] = parent_snp

        if h3_list:
            sql += " AND s.centroids && :h3_list"
            params["h3_list"] = h3_list

        final_sql = f"""
            SELECT * FROM ({sql}) as subquery 
            WHERE window_sons >= :min_sons AND hex_count >= :min_hex
            ORDER BY window_sons DESC, hex_count DESC 
        """

        result = session.execute(text(final_sql), params)
        return [dict(row._mapping) for row in result]
