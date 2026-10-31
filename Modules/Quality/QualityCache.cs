using System;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Quality;

// Client-scoped persistent results. Only opaque 16-byte browser IDs and
// 64-bit hashes of source/movie identity are stored; never JacRed credentials.
public static class QualityCache
{
    private static readonly object Gate = new();
    private static bool initialized;
    private static int writes;
    private const int MaxRows = 25000;
    private static string FileName => Path.Combine(Environment.CurrentDirectory, "database", "quality-cache.db");

    public static bool ValidIds(string? scope, string? source, string? movie)
        => Regex.IsMatch(scope ?? "", @"\A[a-f0-9]{32}\z")
            && Regex.IsMatch(source ?? "", @"\A[a-f0-9]{16}\z")
            && Regex.IsMatch(movie ?? "", @"\A[a-f0-9]{16}\z");

    public static bool ValidLabel(string? label)
        => label == null || label is "CAM" or "TS" or "TC" or "SD" or "HD" or "FHD" or "4K";

    private static SqliteConnection Open()
    {
        var db = FileName;
        Directory.CreateDirectory(Path.GetDirectoryName(db)!);
        var conn = new SqliteConnection(new SqliteConnectionStringBuilder {
            DataSource = db, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true
        }.ToString());
        conn.Open();
        if (!initialized)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"CREATE TABLE IF NOT EXISTS quality_cache(
                scope TEXT NOT NULL, source TEXT NOT NULL, movie TEXT NOT NULL,
                label TEXT, expires INTEGER NOT NULL, touched INTEGER NOT NULL,
                PRIMARY KEY(scope, source, movie));
                CREATE INDEX IF NOT EXISTS quality_cache_expiry ON quality_cache(expires);";
            cmd.ExecuteNonQuery();
            initialized = true;
        }
        return conn;
    }

    public static (bool hit, string? label, long until) Get(string scope, string source, string movie)
    {
        if (!ValidIds(scope, source, movie)) return (false, null, 0);
        lock (Gate)
        {
            using var db = Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = @"SELECT label, expires FROM quality_cache
                WHERE scope=$scope AND source=$source AND movie=$movie AND expires>$now LIMIT 1";
            cmd.Parameters.AddWithValue("$scope", scope);
            cmd.Parameters.AddWithValue("$source", source);
            cmd.Parameters.AddWithValue("$movie", movie);
            cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            using var reader = cmd.ExecuteReader();
            if (!reader.Read()) return (false, null, 0);
            return (true, reader.IsDBNull(0) ? null : reader.GetString(0), reader.GetInt64(1));
        }
    }

    public static void Put(string scope, string source, string movie, string? label)
    {
        if (!ValidIds(scope, source, movie) || !ValidLabel(label)) return;
        lock (Gate)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            long days = label is "CAM" or "TS" or "TC" or null ? 1
                : label == "4K" ? 10 : 5;
            using var db = Open();
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = @"INSERT INTO quality_cache(scope, source, movie, label, expires, touched)
                    VALUES($scope,$source,$movie,$label,$expires,$now)
                    ON CONFLICT(scope, source, movie) DO UPDATE SET
                        label=excluded.label, expires=excluded.expires, touched=excluded.touched";
                cmd.Parameters.AddWithValue("$scope", scope);
                cmd.Parameters.AddWithValue("$source", source);
                cmd.Parameters.AddWithValue("$movie", movie);
                cmd.Parameters.AddWithValue("$label", (object?)label ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$expires", now + days * 86400000L);
                cmd.Parameters.AddWithValue("$now", now);
                cmd.ExecuteNonQuery();
            }

            if (++writes % 64 == 0)
            {
                using var prune = db.CreateCommand();
                prune.CommandText = @"DELETE FROM quality_cache WHERE expires <= $now;
                    DELETE FROM quality_cache WHERE rowid IN (
                    SELECT rowid FROM quality_cache ORDER BY touched DESC
                    LIMIT -1 OFFSET 25000);";
                prune.Parameters.AddWithValue("$now", now);
                prune.ExecuteNonQuery();
            }
        }
    }
}
