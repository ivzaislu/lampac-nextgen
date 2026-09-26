using DatabaseEditor;
using Microsoft.Data.Sqlite;
using System.Reflection;
using System.Text;

namespace DatabaseEditorMigrationSmoke;

internal static class Program
{
    const string OldUser = "email@gmail.com";
    const string NewUser = "emailgmail.com";
    static readonly List<string> Report = new();
    static string Root;

    static async Task Main()
    {
        Root = Environment.GetEnvironmentVariable("MIGRATION_SMOKE_ROOT");
        if (string.IsNullOrWhiteSpace(Root))
            Root = Path.Combine(Path.GetTempPath(), "lampac-db-editor-merge-smoke");

        Root = Path.GetFullPath(Root);
        if (Directory.Exists(Root))
            Directory.Delete(Root, recursive: true);
        Directory.CreateDirectory(Path.Combine(Root, "database"));

        string previous = Environment.CurrentDirectory;
        try
        {
            Environment.CurrentDirectory = Root;
            await CreateSyncAsync();
            await CreateTimeCodeAsync();
            await SeedAsync();

            Log("=== SAFE MIGRATION SMOKE TEST ===");
            Log($"root={Root}");
            Log($"case={OldUser} -> {NewUser}");
            Log("");
            Log("=== BEFORE MIGRATION ===");
            await PrintStateAsync();

            MergeUserResult result = await RunMergeAsync();

            Log("");
            Log("=== MERGE RESULT ===");
            Log($"Sync: source={result.sync.sourceRecords}, moved={result.sync.movedRecords}, replacedTarget={result.sync.replacedTargetRecords}, keptTarget={result.sync.keptTargetRecords}");
            Log($"TimeCode: source={result.timecode.sourceRecords}, moved={result.timecode.movedRecords}, replacedTarget={result.timecode.replacedTargetRecords}, keptTarget={result.timecode.keptTargetRecords}");

            Require(result.sync.sourceRecords == 4, "Sync source count = 4");
            Require(result.sync.movedRecords == 2, "Sync moved = 2");
            Require(result.sync.replacedTargetRecords == 1, "Sync replaced target = 1");
            Require(result.sync.keptTargetRecords == 2, "Sync kept target = 2");

            Require(result.timecode.sourceRecords == 4, "TimeCode source count = 4");
            Require(result.timecode.movedRecords == 2, "TimeCode moved = 2");
            Require(result.timecode.replacedTargetRecords == 1, "TimeCode replaced target = 1");
            Require(result.timecode.keptTargetRecords == 2, "TimeCode kept target = 2");

            Log("");
            Log("=== AFTER MIGRATION ===");
            await PrintStateAsync();
            await VerifyFinalStateAsync();

            Log("");
            Log("=== BACKUPS ===");
            await VerifyBackupsAsync(result.backups);

            Log("");
            Log("MIGRATION_SMOKE_TEST=PASS");
        }
        catch (Exception ex)
        {
            Log("");
            Log("MIGRATION_SMOKE_TEST=FAIL");
            Log(ex.ToString());
            throw;
        }
        finally
        {
            Environment.CurrentDirectory = previous;
            Directory.CreateDirectory(Root);
            await File.WriteAllLinesAsync(Path.Combine(Root, "report.txt"), Report, Encoding.UTF8);
        }
    }

    static async Task<MergeUserResult> RunMergeAsync()
    {
        Type store = typeof(MergeUserRequest).Assembly.GetType("DatabaseEditor.DatabaseStore", throwOnError: true);
        MethodInfo method = store.GetMethod("MergeUserAsync", BindingFlags.Public | BindingFlags.Static)
            ?? throw new InvalidOperationException("MergeUserAsync not found");

        var request = new MergeUserRequest { oldUser = OldUser, newUser = NewUser };
        var task = (Task<MergeUserResult>)method.Invoke(null, new object[] { request });
        return await task;
    }

    static async Task CreateSyncAsync()
    {
        await using var db = await OpenAsync("database/Sync.sql");
        await ExecAsync(db, """
            CREATE TABLE bookmarks (
                Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                user TEXT NOT NULL,
                card_id TEXT NOT NULL,
                card TEXT NULL,
                categories TEXT NOT NULL,
                changed_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IX_bookmarks_user_card_id ON bookmarks (user, card_id);
            CREATE INDEX IX_bookmarks_user_updated_at ON bookmarks (user, updated_at);
            """);
    }

    static async Task CreateTimeCodeAsync()
    {
        await using var db = await OpenAsync("database/TimeCode.sql");
        await ExecAsync(db, """
            CREATE TABLE timecodes (
                Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                user TEXT NOT NULL,
                identity TEXT NULL,
                card TEXT NOT NULL,
                item TEXT NULL,
                position REAL NOT NULL DEFAULT 0,
                duration REAL NOT NULL DEFAULT 0,
                percent REAL NOT NULL DEFAULT 0,
                profile INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                watched_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                extra TEXT NULL
            );
            CREATE UNIQUE INDEX IX_timecodes_user_card_item ON timecodes (user, card, item);
            CREATE UNIQUE INDEX IX_timecodes_user_identity ON timecodes (user, identity) WHERE identity IS NOT NULL;
            CREATE INDEX IX_timecodes_user_updated_at ON timecodes (user, updated_at);
            """);
    }

    static async Task SeedAsync()
    {
        await using (var db = await OpenAsync("database/Sync.sql"))
        {
            await InsertSyncAsync(db, OldUser, "100", "source-unique", 1000, 10);
            await InsertSyncAsync(db, NewUser, "200", "target-unique", 2000, 20);

            await InsertSyncAsync(db, OldUser, "300", "source-newer", 5000, 30);
            await InsertSyncAsync(db, NewUser, "300", "target-older", 4000, 60);

            await InsertSyncAsync(db, OldUser, "400", "source-older", 6000, 70);
            await InsertSyncAsync(db, NewUser, "400", "target-newer", 7000, 40);

            await InsertSyncAsync(db, OldUser, "500", "source-fallback-older", 0, 80);
            await InsertSyncAsync(db, NewUser, "500", "target-fallback-newer", 0, 90);
        }

        await using (var db = await OpenAsync("database/TimeCode.sql"))
        {
            await InsertTimeCodeAsync(db, OldUser, "movie-100", "100_movie", "hash100", "source-unique", 1000, 10);
            await InsertTimeCodeAsync(db, NewUser, "movie-200", "200_movie", "hash200", "target-unique", 2000, 20);

            await InsertTimeCodeAsync(db, OldUser, "movie-300", "300_movie", "source-hash300", "source-newer-identity", 5000, 30);
            await InsertTimeCodeAsync(db, NewUser, "movie-300", "300_movie", "target-hash300", "target-older-identity", 4000, 60);

            await InsertTimeCodeAsync(db, OldUser, "movie-400-source", "400_movie", "hash400", "source-older-hash", 6000, 70);
            await InsertTimeCodeAsync(db, NewUser, "movie-400-target", "400_movie", "hash400", "target-newer-hash", 7000, 40);

            // Двойной конфликт для одной source-строки:
            // - target A конфликтует по identity и НОВЕЕ source по watched_at;
            // - target B конфликтует по card+item, старее source, но имеет больший updated_at.
            // Без сравнения со ВСЕМИ конфликтующими строками код может ошибочно удалить target A.
            await InsertTimeCodeAsync(db, OldUser, "movie-500", "500_movie", "hash500", "source-double-conflict", 9000, 80);
            await InsertTimeCodeAsync(db, NewUser, "movie-500", "500_movie", "other-hash500", "target-newer-identity", 9500, 91);
            await InsertTimeCodeAsync(db, NewUser, "movie-500-other", "500_movie", "hash500", "target-older-hash", 7000, 92);
        }
    }

    static async Task InsertSyncAsync(SqliteConnection db, string user, string cardId, string marker, long changedAt, long updatedAt)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO bookmarks (user, card_id, card, categories, changed_at, updated_at)
            VALUES (@user, @cardId, @card, '{}', @changedAt, @updatedAt);
            """;
        cmd.Parameters.AddWithValue("@user", user);
        cmd.Parameters.AddWithValue("@cardId", cardId);
        cmd.Parameters.AddWithValue("@card", marker);
        cmd.Parameters.AddWithValue("@changedAt", changedAt);
        cmd.Parameters.AddWithValue("@updatedAt", updatedAt);
        await cmd.ExecuteNonQueryAsync();
    }

    static async Task InsertTimeCodeAsync(SqliteConnection db, string user, string identity, string card, string item, string marker, long watchedAt, long updatedAt)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO timecodes (user, identity, card, item, position, duration, percent, profile, deleted, watched_at, updated_at, extra)
            VALUES (@user, @identity, @card, @item, 10, 100, 10, 0, 0, @watchedAt, @updatedAt, @extra);
            """;
        cmd.Parameters.AddWithValue("@user", user);
        cmd.Parameters.AddWithValue("@identity", identity);
        cmd.Parameters.AddWithValue("@card", card);
        cmd.Parameters.AddWithValue("@item", item);
        cmd.Parameters.AddWithValue("@watchedAt", watchedAt);
        cmd.Parameters.AddWithValue("@updatedAt", updatedAt);
        cmd.Parameters.AddWithValue("@extra", marker);
        await cmd.ExecuteNonQueryAsync();
    }

    static async Task PrintStateAsync()
    {
        await using (var db = await OpenAsync("database/Sync.sql"))
        {
            Log("Sync:");
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT user, card_id, card, changed_at, updated_at FROM bookmarks ORDER BY user, card_id;";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                Log($"  {reader.GetString(0)} | card={reader.GetString(1)} | marker={Text(reader, 2)} | changed={reader.GetInt64(3)} | updated={reader.GetInt64(4)}");
        }

        await using (var db = await OpenAsync("database/TimeCode.sql"))
        {
            Log("TimeCode:");
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT user, identity, card, item, extra, watched_at, updated_at FROM timecodes ORDER BY user, identity, item;";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                Log($"  {reader.GetString(0)} | identity={Text(reader, 1)} | card={reader.GetString(2)} | item={Text(reader, 3)} | marker={Text(reader, 4)} | watched={reader.GetInt64(5)} | updated={reader.GetInt64(6)}");
        }
    }

    static async Task VerifyFinalStateAsync()
    {
        await using (var db = await OpenAsync("database/Sync.sql"))
        {
            Require(await CountAsync(db, "bookmarks", OldUser) == 0, "Sync source removed");
            Require(await CountAsync(db, "bookmarks", NewUser) == 5, "Sync target final count = 5");
            Require(await MarkerAsync(db, "bookmarks", "card", "card_id", "300") == "source-newer", "Sync source newer wins");
            Require(await MarkerAsync(db, "bookmarks", "card", "card_id", "400") == "target-newer", "Sync target newer wins");
            Require(await MarkerAsync(db, "bookmarks", "card", "card_id", "500") == "target-fallback-newer", "Sync updated_at fallback wins");
            Require(await MinStampAsync(db, "bookmarks", "card_id", new[] { "100", "300" }) > 90, "Sync moved rows get fresh cursor");
        }

        await using (var db = await OpenAsync("database/TimeCode.sql"))
        {
            Require(await CountAsync(db, "timecodes", OldUser) == 0, "TimeCode source removed");
            Require(await CountAsync(db, "timecodes", NewUser) == 6, "TimeCode target final count = 6");
            Require(await MarkerAsync(db, "timecodes", "extra", "identity", "movie-300") == "source-newer-identity", "TimeCode source newer identity wins");
            Require(await MarkerAsync(db, "timecodes", "extra", "item", "hash400") == "target-newer-hash", "TimeCode target newer hash wins");

            // Source movie-500 обязан проиграть, потому что один из ДВУХ конфликтующих target новее по watched_at.
            Require(await MarkerAsync(db, "timecodes", "extra", "identity", "movie-500") == "target-newer-identity", "TimeCode newer target identity survives double conflict");
            Require(await MarkerAsync(db, "timecodes", "extra", "item", "hash500") == "target-older-hash", "TimeCode second target row survives when source loses double conflict");
            Require(await ScalarLongAsync(db, "SELECT COUNT(*) FROM timecodes WHERE user = @user AND card = '500_movie';", NewUser) == 2, "TimeCode double conflict keeps both target rows");
            Require(await MinStampAsync(db, "timecodes", "identity", new[] { "movie-100", "movie-300" }) > 92, "TimeCode moved rows get fresh cursor");
        }
    }

    static async Task VerifyBackupsAsync(List<DatabaseBackupResult> backups)
    {
        Require(backups != null && backups.Count == 2, "Two backups returned");

        foreach (DatabaseBackupResult backup in backups.OrderBy(i => i.database))
        {
            string path = Path.GetFullPath(backup.path);
            Require(File.Exists(path), $"{backup.database} backup exists");

            await using var db = await OpenAsync(path, readOnly: true);
            await using var check = db.CreateCommand();
            check.CommandText = "PRAGMA quick_check;";
            Require(string.Equals(Convert.ToString(await check.ExecuteScalarAsync()), "ok", StringComparison.OrdinalIgnoreCase), $"{backup.database} backup quick_check=ok");

            string table = backup.database == "sync" ? "bookmarks" : "timecodes";
            long oldCount = await CountAsync(db, table, OldUser);
            long newCount = await CountAsync(db, table, NewUser);
            long bytes = new FileInfo(path).Length;

            if (backup.database == "sync")
                Require(oldCount == 4 && newCount == 4, "Sync backup is pre-merge snapshot (4 + 4)");
            else
                Require(oldCount == 4 && newCount == 5, "TimeCode backup is pre-merge snapshot (4 + 5)");

            Log($"  {backup.database}: {backup.path} | bytes={bytes} | quick_check=ok | {OldUser}={oldCount} | {NewUser}={newCount}");
        }
    }

    static async Task<SqliteConnection> OpenAsync(string path, bool readOnly = false)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
            Pooling = false
        };
        var db = new SqliteConnection(builder.ToString());
        await db.OpenAsync();
        return db;
    }

    static async Task ExecAsync(SqliteConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    static async Task<long> CountAsync(SqliteConnection db, string table, string user)
        => await ScalarLongAsync(db, $"SELECT COUNT(*) FROM {table} WHERE user = @user;", user);

    static async Task<long> ScalarLongAsync(SqliteConnection db, string sql, string user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("@user", user);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    static async Task<string> MarkerAsync(SqliteConnection db, string table, string markerColumn, string keyColumn, string key)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT {markerColumn} FROM {table} WHERE user = @user AND {keyColumn} = @key LIMIT 1;";
        cmd.Parameters.AddWithValue("@user", NewUser);
        cmd.Parameters.AddWithValue("@key", key);
        return Convert.ToString(await cmd.ExecuteScalarAsync());
    }

    static async Task<long> MinStampAsync(SqliteConnection db, string table, string keyColumn, string[] keys)
    {
        string args = string.Join(",", keys.Select((_, index) => $"@key{index}"));
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT MIN(updated_at) FROM {table} WHERE user = @user AND {keyColumn} IN ({args});";
        cmd.Parameters.AddWithValue("@user", NewUser);
        for (int i = 0; i < keys.Length; i++)
            cmd.Parameters.AddWithValue($"@key{i}", keys[i]);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    static string Text(SqliteDataReader reader, int index)
        => reader.IsDBNull(index) ? "NULL" : reader.GetString(index);

    static void Require(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException("ASSERT FAILED: " + message);
        Log("  PASS: " + message);
    }

    static void Log(string value)
    {
        Console.WriteLine(value);
        Report.Add(value);
    }
}
