using Microsoft.Data.Sqlite;
using Shared.Services;
using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace DatabaseEditor;

static class TranslationSubEditorStore
{
    const int MaxDataBytes = 8 * 1024 * 1024;
    const int MaxKeyLength = 512;
    const string SemaphoreName = "TranslationSub";

    public const string DatabaseKey = "translationsub";
    public const string SubscriptionsKey = "translationsub-subscriptions";
    public const string SettingsKey = "translationsub-settings";
    public const string ProgressKey = "translationsub-progress";

    static readonly string DatabasePath = Path.Combine("database", "translationsub.db");
    static readonly string BackupDirectory = Path.Combine("database", "backup", "database-editor");

    sealed class TableSpec
    {
        public string key;
        public string table;
        public string updatedExpression;
        public string jsonExpression;
    }

    static readonly TableSpec Subscriptions = new()
    {
        key = SubscriptionsKey,
        table = "subscriptions",
        updatedExpression = "COALESCE(last_checked_at, tmdb_last_synced_at, created_at)",
        jsonExpression = @"json_object(
            'id', id,
            'content_id', content_id,
            'title', title,
            'original_title', original_title,
            'kp_id', kp_id,
            'imdb_id', imdb_id,
            'tmdb_id', tmdb_id,
            'poster', poster,
            'year', year,
            'is_serial', is_serial,
            'source', source,
            'translation_id', translation_id,
            'translation_name', translation_name,
            'current_season', current_season,
            'last_season', last_season,
            'last_episode', last_episode,
            'sources_json', json(CASE WHEN json_valid(sources_json) THEN sources_json ELSE '[]' END),
            'created_at', created_at,
            'last_checked_at', last_checked_at,
            'tmdb_status', tmdb_status,
            'tmdb_last_season', tmdb_last_season,
            'tmdb_last_episode', tmdb_last_episode,
            'tmdb_last_air_date', tmdb_last_air_date,
            'tmdb_next_season', tmdb_next_season,
            'tmdb_next_episode', tmdb_next_episode,
            'tmdb_next_air_date', tmdb_next_air_date,
            'tmdb_target_season_episodes', tmdb_target_season_episodes,
            'tmdb_last_synced_at', tmdb_last_synced_at,
            'schedule_state', schedule_state,
            'tmdb_new_season_available', tmdb_new_season_available
        )"
    };

    static readonly TableSpec Settings = new()
    {
        key = SettingsKey,
        table = "settings",
        updatedExpression = "updated_at",
        jsonExpression = @"json_object(
            'check_interval_hours', check_interval_hours,
            'sources_json', json(CASE WHEN json_valid(sources_json) THEN sources_json ELSE '[]' END),
            'use_tmdb_schedule', use_tmdb_schedule,
            'tmdb_refresh_hours', tmdb_refresh_hours,
            'ended_refresh_days', ended_refresh_days,
            'new_season_mode', new_season_mode,
            'updated_at', updated_at
        )"
    };

    static readonly TableSpec Progress = new()
    {
        key = ProgressKey,
        table = "profile_progress",
        updatedExpression = "updated_at",
        jsonExpression = @"json_object(
            'profile_id', profile_id,
            'subscription_id', subscription_id,
            'watched_episode', watched_episode,
            'updated_at', updated_at
        )"
    };

    public static bool Available => File.Exists(DatabasePath);

    public static bool IsRecordDatabase(string database)
        => string.Equals(database, SubscriptionsKey, StringComparison.OrdinalIgnoreCase)
        || string.Equals(database, SettingsKey, StringComparison.OrdinalIgnoreCase)
        || string.Equals(database, ProgressKey, StringComparison.OrdinalIgnoreCase);

    public static bool IsBackupDatabase(string database)
        => string.Equals(database, DatabaseKey, StringComparison.OrdinalIgnoreCase)
        || IsRecordDatabase(database);

    public static async Task<DatabaseSummary> GetSummaryAsync()
    {
        var summary = new DatabaseSummary
        {
            database = DatabaseKey,
            title = "TranslationSub",
            file = DatabasePath.Replace('\\', '/'),
            available = Available,
            bytes = Available ? new FileInfo(DatabasePath).Length : 0
        };

        if (!summary.available)
            return summary;

        await using var connection = await OpenAsync();
        await EnsureSchemaAsync(connection);

        await using (var count = connection.CreateCommand())
        {
            count.CommandText = @"
SELECT
    (SELECT COUNT(*) FROM settings) +
    (SELECT COUNT(*) FROM subscriptions) +
    (SELECT COUNT(*) FROM profile_progress);";
            summary.records = Convert.ToInt64(await count.ExecuteScalarAsync());
        }

        await using (var updated = connection.CreateCommand())
        {
            updated.CommandText = @"
SELECT MAX(value)
FROM (
    SELECT updated_at AS value FROM settings
    UNION ALL
    SELECT COALESCE(last_checked_at, tmdb_last_synced_at, created_at) AS value FROM subscriptions
    UNION ALL
    SELECT updated_at AS value FROM profile_progress
);";
            summary.updated = Convert.ToString(await updated.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
        }

        return summary;
    }

    public static async Task<List<DatabaseUserOption>> GetUsersAsync(string database)
    {
        TableSpec spec = GetSpec(database);
        await using var connection = await OpenAsync();
        await EnsureSchemaAsync(connection);

        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT uid, COUNT(*) FROM {spec.table} WHERE uid IS NOT NULL AND TRIM(uid) <> '' GROUP BY uid COLLATE NOCASE ORDER BY uid COLLATE NOCASE;";

        var users = new List<DatabaseUserOption>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            users.Add(new DatabaseUserOption
            {
                user = ReadString(reader, 0),
                records = reader.IsDBNull(1) ? 0 : reader.GetInt64(1)
            });
        }

        return users;
    }

    public static async Task<RecordsPage> GetRecordsAsync(string database, string query, int page, int pageSize, string user = null)
    {
        TableSpec spec = GetSpec(database);
        page = Math.Max(1, page);
        pageSize = pageSize is 25 or 50 or 100 ? pageSize : 25;

        query = (query ?? string.Empty).Trim();
        if (query.Length > 256)
            throw new DatabaseEditorValidationException("search_too_long");

        user = (user ?? string.Empty).Trim();
        if (user.Length > MaxKeyLength)
            throw new DatabaseEditorValidationException("key_too_long");

        string searchValue = string.IsNullOrEmpty(query)
            ? null
            : "%" + query.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
        string selectedUser = string.IsNullOrEmpty(user) ? null : user;

        var clauses = new List<string>();
        if (searchValue != null)
            clauses.Add($"(CAST(rowid AS TEXT) LIKE @search ESCAPE '\\' OR uid LIKE @search ESCAPE '\\' COLLATE NOCASE OR CAST({spec.jsonExpression} AS TEXT) LIKE @search ESCAPE '\\' COLLATE NOCASE)");
        if (selectedUser != null)
            clauses.Add("uid = @selectedUser COLLATE NOCASE");

        string where = clauses.Count == 0 ? string.Empty : " WHERE " + string.Join(" AND ", clauses);

        await using var connection = await OpenAsync();
        await EnsureSchemaAsync(connection);

        long total;
        await using (var count = connection.CreateCommand())
        {
            count.CommandText = $"SELECT COUNT(*) FROM {spec.table}{where};";
            AddFilters(count, searchValue, selectedUser);
            total = Convert.ToInt64(await count.ExecuteScalarAsync());
        }

        int pages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        page = Math.Min(page, pages);
        int offset = (page - 1) * pageSize;
        var records = new List<DatabaseRecord>(pageSize);

        await using (var command = connection.CreateCommand())
        {
            command.CommandText = spec == Subscriptions
                ? $"SELECT rowid, uid, length({spec.jsonExpression}), substr({spec.jsonExpression}, 1, 420), {spec.updatedExpression}, " +
                  "COALESCE(NULLIF(title, ''), NULLIF(original_title, '')), poster, year, is_serial, source, translation_name, " +
                  "COALESCE(current_season, last_season), last_episode, id, schedule_state, tmdb_status, tmdb_new_season_available " +
                  $"FROM {spec.table}{where} ORDER BY {spec.updatedExpression} DESC, rowid DESC LIMIT @limit OFFSET @offset;"
                : $"SELECT rowid, uid, length({spec.jsonExpression}), substr({spec.jsonExpression}, 1, 420), {spec.updatedExpression} " +
                  $"FROM {spec.table}{where} ORDER BY {spec.updatedExpression} DESC, rowid DESC LIMIT @limit OFFSET @offset;";
            AddFilters(command, searchValue, selectedUser);
            command.Parameters.AddWithValue("@limit", pageSize);
            command.Parameters.AddWithValue("@offset", offset);

            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                string preview = ReadString(reader, 3);
                var record = new DatabaseRecord
                {
                    id = reader.GetInt64(0),
                    user = ReadString(reader, 1),
                    dataLength = reader.IsDBNull(2) ? 0 : reader.GetInt64(2),
                    preview = BuildPreview(preview),
                    updated = ReadString(reader, 4)
                };

                if (spec == Subscriptions)
                {
                    record.title = ReadString(reader, 5);
                    record.poster = ReadString(reader, 6);
                    record.year = reader.IsDBNull(7) ? null : Convert.ToString(reader.GetInt32(7), CultureInfo.InvariantCulture);
                    record.mediaType = !reader.IsDBNull(8) && reader.GetInt32(8) != 0 ? "tv" : "movie";
                    record.source = ReadString(reader, 9);
                    record.translationName = ReadString(reader, 10);
                    record.season = reader.IsDBNull(11) ? null : reader.GetInt32(11);
                    record.episode = reader.IsDBNull(12) ? null : reader.GetInt32(12);
                    record.subscriptionId = ReadString(reader, 13);
                    record.scheduleState = ReadString(reader, 14);
                    record.tmdbStatus = ReadString(reader, 15);
                    record.newSeasonAvailable = !reader.IsDBNull(16) && reader.GetInt32(16) != 0;
                }

                records.Add(record);
            }
        }

        return new RecordsPage
        {
            database = spec.key,
            page = page,
            pageSize = pageSize,
            total = total,
            pages = pages,
            records = records
        };
    }

    public static async Task<DatabaseRecord> GetRecordAsync(string database, long id)
    {
        TableSpec spec = GetSpec(database);
        if (id <= 0)
            throw new DatabaseEditorValidationException("invalid_id");

        await using var connection = await OpenAsync();
        await EnsureSchemaAsync(connection);

        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT rowid, uid, {spec.jsonExpression}, {spec.updatedExpression} FROM {spec.table} WHERE rowid = @id LIMIT 1;";
        command.Parameters.AddWithValue("@id", id);

        await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SingleRow);
        if (!await reader.ReadAsync())
            return null;

        string data = ReadString(reader, 2);
        return new DatabaseRecord
        {
            id = reader.GetInt64(0),
            user = ReadString(reader, 1),
            data = data,
            dataLength = Encoding.UTF8.GetByteCount(data ?? string.Empty),
            preview = BuildPreview(data),
            updated = ReadString(reader, 3)
        };
    }

    public static async Task<DatabaseRecord> SaveAsync(SaveRecordRequest request)
    {
        if (request == null)
            throw new DatabaseEditorValidationException("request_required");

        TableSpec spec = GetSpec(request.database);
        string uid = ValidateKey(request.user, "user_required");
        string data = NormalizeJson(request.data);
        long rowid = request.id.GetValueOrDefault();
        if (rowid < 0)
            throw new DatabaseEditorValidationException("invalid_id");

        using var document = JsonDocument.Parse(data);
        ValidatePayload(spec, document.RootElement);
        string newSubscriptionId = spec == Subscriptions ? RequiredJsonText(document.RootElement, "id", "translation_subscription_id_required") : null;

        var semaphore = new SemaphorManager(SemaphoreName, TimeSpan.FromSeconds(20));
        if (!await semaphore.WaitAsync())
            throw new DatabaseEditorBusyException("database_busy");

        try
        {
            await using var connection = await OpenAsync();
            await EnsureSchemaAsync(connection);
            using var transaction = connection.BeginTransaction();

            (string uid, string id)? oldSubscription = null;
            if (spec == Subscriptions && rowid > 0)
                oldSubscription = await ReadSubscriptionIdentityAsync(connection, transaction, rowid);

            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = SaveSql(spec, rowid == 0);
            command.Parameters.AddWithValue("@user", uid);
            command.Parameters.AddWithValue("@data", data);
            command.Parameters.AddWithValue("@now", DateTime.Now.ToString("O", CultureInfo.InvariantCulture));
            if (rowid > 0)
                command.Parameters.AddWithValue("@rowid", rowid);

            if (rowid == 0)
                rowid = Convert.ToInt64(await command.ExecuteScalarAsync());
            else if (await command.ExecuteNonQueryAsync() == 0)
                throw new DatabaseEditorValidationException("record_not_found");

            if (spec == Subscriptions && oldSubscription.HasValue)
            {
                var old = oldSubscription.Value;
                if (!string.Equals(old.uid, uid, StringComparison.Ordinal)
                    || !string.Equals(old.id, newSubscriptionId, StringComparison.Ordinal))
                {
                    await DeleteProgressForSubscriptionAsync(connection, transaction, old.uid, old.id);
                }
            }

            transaction.Commit();
            Serilog.Log.Information("DatabaseEditor saved {Database} row {RowId}", spec.key, rowid);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new DatabaseEditorConflictException("duplicate_record_key");
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode is 5 or 6)
        {
            throw new DatabaseEditorBusyException("database_busy");
        }
        finally
        {
            semaphore.Release();
        }

        return await GetRecordAsync(spec.key, rowid);
    }

    public static async Task<bool> DeleteAsync(string database, long id)
    {
        TableSpec spec = GetSpec(database);
        if (id <= 0)
            throw new DatabaseEditorValidationException("invalid_id");

        var semaphore = new SemaphorManager(SemaphoreName, TimeSpan.FromSeconds(20));
        if (!await semaphore.WaitAsync())
            throw new DatabaseEditorBusyException("database_busy");

        try
        {
            await using var connection = await OpenAsync();
            await EnsureSchemaAsync(connection);
            using var transaction = connection.BeginTransaction();

            if (spec == Subscriptions)
            {
                var identity = await ReadSubscriptionIdentityAsync(connection, transaction, id);
                if (identity.HasValue)
                    await DeleteProgressForSubscriptionAsync(connection, transaction, identity.Value.uid, identity.Value.id);
            }

            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = $"DELETE FROM {spec.table} WHERE rowid = @id;";
            command.Parameters.AddWithValue("@id", id);
            bool deleted = await command.ExecuteNonQueryAsync() > 0;
            transaction.Commit();

            if (deleted)
                Serilog.Log.Information("DatabaseEditor deleted {Database} row {RowId}", spec.key, id);
            return deleted;
        }
        finally
        {
            semaphore.Release();
        }
    }

    public static async Task<string> BackupAsync()
    {
        if (!Available)
            throw new DatabaseEditorValidationException("database_not_found");

        var semaphore = new SemaphorManager(SemaphoreName, TimeSpan.FromSeconds(20));
        if (!await semaphore.WaitAsync())
            throw new DatabaseEditorBusyException("database_busy");

        try
        {
            Directory.CreateDirectory(BackupDirectory);
            string destinationPath = Path.Combine(BackupDirectory, $"translationsub-{DateTime.Now:yyyyMMdd-HHmmssfff}.sql");
            if (File.Exists(destinationPath))
                destinationPath = Path.Combine(BackupDirectory, $"translationsub-{DateTime.Now:yyyyMMdd-HHmmssfff}-{Guid.NewGuid():N}.sql");

            await using var source = await OpenAsync();
            await EnsureSchemaAsync(source);

            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = destinationPath,
                Mode = SqliteOpenMode.ReadWriteCreate,
                Pooling = false
            };
            await using var destination = new SqliteConnection(builder.ToString());
            await destination.OpenAsync();
            source.BackupDatabase(destination);

            Serilog.Log.Information("DatabaseEditor backed up TranslationSub to {BackupPath}", destinationPath);
            return destinationPath.Replace('\\', '/');
        }
        finally
        {
            semaphore.Release();
        }
    }

    public static List<DatabaseBackupFile> GetBackups()
    {
        var result = new List<DatabaseBackupFile>();
        if (!Directory.Exists(BackupDirectory))
            return result;

        foreach (string path in Directory.GetFiles(BackupDirectory, "translationsub-*.sql"))
        {
            var file = new FileInfo(path);
            result.Add(new DatabaseBackupFile
            {
                database = DatabaseKey,
                file = file.Name,
                path = path.Replace('\\', '/'),
                bytes = file.Length,
                created = file.LastWriteTimeUtc.ToString("O")
            });
        }

        result.Sort((left, right) => string.CompareOrdinal(right.created, left.created));
        return result;
    }

    public static async Task<DatabaseRestoreResult> RestoreAsync(RestoreBackupRequest request)
    {
        if (request == null)
            throw new DatabaseEditorValidationException("request_required");

        string fileName = Path.GetFileName((request.file ?? string.Empty).Trim());
        if (string.IsNullOrEmpty(fileName) || !string.Equals(fileName, request.file?.Trim(), StringComparison.Ordinal))
            throw new DatabaseEditorValidationException("invalid_backup_file");
        if (!fileName.StartsWith("translationsub-", StringComparison.OrdinalIgnoreCase)
            || !fileName.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            throw new DatabaseEditorValidationException("invalid_backup_file");

        string directory = Path.GetFullPath(BackupDirectory);
        string sourcePath = Path.GetFullPath(Path.Combine(directory, fileName));
        if (!sourcePath.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(sourcePath))
            throw new DatabaseEditorValidationException("backup_not_found");

        var semaphore = new SemaphorManager(SemaphoreName, TimeSpan.FromSeconds(20));
        if (!await semaphore.WaitAsync())
            throw new DatabaseEditorBusyException("database_busy");

        try
        {
            await ValidateBackupAsync(sourcePath);
            string safetyPath = await CreateBackupLockedAsync("before-restore");

            var sourceBuilder = new SqliteConnectionStringBuilder
            {
                DataSource = sourcePath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false
            };
            await using (var source = new SqliteConnection(sourceBuilder.ToString()))
            {
                await source.OpenAsync();
                await using var destination = await OpenAsync();
                source.BackupDatabase(destination);
            }

            SqliteConnection.ClearAllPools();
            Serilog.Log.Warning("DatabaseEditor restored TranslationSub from {BackupPath}; safety backup: {SafetyPath}", sourcePath, safetyPath);

            return new DatabaseRestoreResult
            {
                database = DatabaseKey,
                restoredFrom = sourcePath.Replace('\\', '/'),
                safetyBackup = safetyPath
            };
        }
        finally
        {
            semaphore.Release();
        }
    }

    static TableSpec GetSpec(string database)
    {
        if (string.Equals(database, SubscriptionsKey, StringComparison.OrdinalIgnoreCase))
            return Subscriptions;
        if (string.Equals(database, SettingsKey, StringComparison.OrdinalIgnoreCase))
            return Settings;
        if (string.Equals(database, ProgressKey, StringComparison.OrdinalIgnoreCase))
            return Progress;
        throw new DatabaseEditorValidationException("unknown_database");
    }

    static async Task<SqliteConnection> OpenAsync(bool pooling = true)
    {
        if (!Available)
            throw new DatabaseEditorValidationException("database_not_found");

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Shared,
            DefaultTimeout = 10,
            Pooling = pooling
        };
        var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync();

        await using var pragma = connection.CreateCommand();
        pragma.CommandText = @"
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;";
        await pragma.ExecuteNonQueryAsync();
        return connection;
    }

    static async Task EnsureSchemaAsync(SqliteConnection connection)
    {
        foreach (string table in new[] { "settings", "subscriptions", "profile_progress" })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = @table LIMIT 1;";
            command.Parameters.AddWithValue("@table", table);
            if (await command.ExecuteScalarAsync() == null)
                throw new DatabaseEditorValidationException("database_schema_mismatch");
        }
    }

    static void AddFilters(SqliteCommand command, string searchValue, string selectedUser)
    {
        if (searchValue != null)
            command.Parameters.AddWithValue("@search", searchValue);
        if (selectedUser != null)
            command.Parameters.AddWithValue("@selectedUser", selectedUser);
    }

    static string SaveSql(TableSpec spec, bool insert)
    {
        if (spec == Settings)
        {
            if (insert)
            {
                return @"INSERT INTO settings (
    uid, check_interval_hours, sources_json, use_tmdb_schedule,
    tmdb_refresh_hours, ended_refresh_days, new_season_mode, updated_at
) VALUES (
    @user,
    MAX(1, MIN(24, COALESCE(CAST(json_extract(@data, '$.check_interval_hours') AS INTEGER), 1))),
    COALESCE(json_extract(@data, '$.sources_json'), '[]'),
    CASE WHEN COALESCE(CAST(json_extract(@data, '$.use_tmdb_schedule') AS INTEGER), 1) <> 0 THEN 1 ELSE 0 END,
    MAX(6, MIN(168, COALESCE(CAST(json_extract(@data, '$.tmdb_refresh_hours') AS INTEGER), 24))),
    MAX(1, MIN(90, COALESCE(CAST(json_extract(@data, '$.ended_refresh_days') AS INTEGER), 7))),
    CASE LOWER(COALESCE(NULLIF(TRIM(json_extract(@data, '$.new_season_mode')), ''), 'auto'))
        WHEN 'notify' THEN 'notify'
        WHEN 'off' THEN 'off'
        ELSE 'auto'
    END,
    COALESCE(NULLIF(json_extract(@data, '$.updated_at'), ''), @now)
);
SELECT last_insert_rowid();";
            }

            return @"UPDATE settings SET
    uid = @user,
    check_interval_hours = MAX(1, MIN(24, COALESCE(CAST(json_extract(@data, '$.check_interval_hours') AS INTEGER), check_interval_hours))),
    sources_json = COALESCE(json_extract(@data, '$.sources_json'), sources_json),
    use_tmdb_schedule = CASE WHEN COALESCE(CAST(json_extract(@data, '$.use_tmdb_schedule') AS INTEGER), use_tmdb_schedule) <> 0 THEN 1 ELSE 0 END,
    tmdb_refresh_hours = MAX(6, MIN(168, COALESCE(CAST(json_extract(@data, '$.tmdb_refresh_hours') AS INTEGER), tmdb_refresh_hours))),
    ended_refresh_days = MAX(1, MIN(90, COALESCE(CAST(json_extract(@data, '$.ended_refresh_days') AS INTEGER), ended_refresh_days))),
    new_season_mode = CASE LOWER(COALESCE(NULLIF(TRIM(json_extract(@data, '$.new_season_mode')), ''), new_season_mode))
        WHEN 'notify' THEN 'notify'
        WHEN 'off' THEN 'off'
        ELSE 'auto'
    END,
    updated_at = COALESCE(NULLIF(json_extract(@data, '$.updated_at'), ''), updated_at)
WHERE rowid = @rowid;";
        }

        if (spec == Progress)
        {
            return insert
                ? @"INSERT INTO profile_progress (uid, profile_id, subscription_id, watched_episode, updated_at)
VALUES (
    @user,
    COALESCE(NULLIF(TRIM(json_extract(@data, '$.profile_id')), ''), '0'),
    NULLIF(TRIM(json_extract(@data, '$.subscription_id')), ''),
    MAX(0, COALESCE(CAST(json_extract(@data, '$.watched_episode') AS INTEGER), 0)),
    COALESCE(NULLIF(json_extract(@data, '$.updated_at'), ''), @now)
);
SELECT last_insert_rowid();"
                : @"UPDATE profile_progress SET
    uid = @user,
    profile_id = COALESCE(NULLIF(TRIM(json_extract(@data, '$.profile_id')), ''), '0'),
    subscription_id = NULLIF(TRIM(json_extract(@data, '$.subscription_id')), ''),
    watched_episode = MAX(0, COALESCE(CAST(json_extract(@data, '$.watched_episode') AS INTEGER), watched_episode)),
    updated_at = COALESCE(NULLIF(json_extract(@data, '$.updated_at'), ''), updated_at)
WHERE rowid = @rowid;";
        }

        return insert
            ? @"INSERT INTO subscriptions (
    id, uid, content_id, title, original_title, kp_id, imdb_id, tmdb_id,
    poster, year, is_serial, source, translation_id, translation_name,
    current_season, last_season, last_episode, sources_json, created_at,
    last_checked_at, tmdb_status, tmdb_last_season, tmdb_last_episode,
    tmdb_last_air_date, tmdb_next_season, tmdb_next_episode, tmdb_next_air_date,
    tmdb_target_season_episodes, tmdb_last_synced_at, schedule_state,
    tmdb_new_season_available
) VALUES (
    NULLIF(TRIM(json_extract(@data, '$.id')), ''), @user,
    json_extract(@data, '$.content_id'), json_extract(@data, '$.title'),
    json_extract(@data, '$.original_title'), json_extract(@data, '$.kp_id'),
    json_extract(@data, '$.imdb_id'), json_extract(@data, '$.tmdb_id'),
    json_extract(@data, '$.poster'), CAST(json_extract(@data, '$.year') AS INTEGER),
    CASE WHEN COALESCE(CAST(json_extract(@data, '$.is_serial') AS INTEGER), 0) <> 0 THEN 1 ELSE 0 END,
    json_extract(@data, '$.source'), json_extract(@data, '$.translation_id'),
    json_extract(@data, '$.translation_name'), CAST(json_extract(@data, '$.current_season') AS INTEGER),
    CAST(json_extract(@data, '$.last_season') AS INTEGER), CAST(json_extract(@data, '$.last_episode') AS INTEGER),
    COALESCE(json_extract(@data, '$.sources_json'), '[]'),
    COALESCE(NULLIF(json_extract(@data, '$.created_at'), ''), @now),
    json_extract(@data, '$.last_checked_at'), json_extract(@data, '$.tmdb_status'),
    CAST(json_extract(@data, '$.tmdb_last_season') AS INTEGER), CAST(json_extract(@data, '$.tmdb_last_episode') AS INTEGER),
    json_extract(@data, '$.tmdb_last_air_date'), CAST(json_extract(@data, '$.tmdb_next_season') AS INTEGER),
    CAST(json_extract(@data, '$.tmdb_next_episode') AS INTEGER), json_extract(@data, '$.tmdb_next_air_date'),
    CAST(json_extract(@data, '$.tmdb_target_season_episodes') AS INTEGER), json_extract(@data, '$.tmdb_last_synced_at'),
    json_extract(@data, '$.schedule_state'),
    CASE WHEN COALESCE(CAST(json_extract(@data, '$.tmdb_new_season_available') AS INTEGER), 0) <> 0 THEN 1 ELSE 0 END
);
SELECT last_insert_rowid();"
            : @"UPDATE subscriptions SET
    id = NULLIF(TRIM(json_extract(@data, '$.id')), ''),
    uid = @user,
    content_id = json_extract(@data, '$.content_id'),
    title = json_extract(@data, '$.title'),
    original_title = json_extract(@data, '$.original_title'),
    kp_id = json_extract(@data, '$.kp_id'),
    imdb_id = json_extract(@data, '$.imdb_id'),
    tmdb_id = json_extract(@data, '$.tmdb_id'),
    poster = json_extract(@data, '$.poster'),
    year = CAST(json_extract(@data, '$.year') AS INTEGER),
    is_serial = CASE WHEN COALESCE(CAST(json_extract(@data, '$.is_serial') AS INTEGER), is_serial) <> 0 THEN 1 ELSE 0 END,
    source = json_extract(@data, '$.source'),
    translation_id = json_extract(@data, '$.translation_id'),
    translation_name = json_extract(@data, '$.translation_name'),
    current_season = CAST(json_extract(@data, '$.current_season') AS INTEGER),
    last_season = CAST(json_extract(@data, '$.last_season') AS INTEGER),
    last_episode = CAST(json_extract(@data, '$.last_episode') AS INTEGER),
    sources_json = COALESCE(json_extract(@data, '$.sources_json'), sources_json),
    created_at = COALESCE(NULLIF(json_extract(@data, '$.created_at'), ''), created_at),
    last_checked_at = json_extract(@data, '$.last_checked_at'),
    tmdb_status = json_extract(@data, '$.tmdb_status'),
    tmdb_last_season = CAST(json_extract(@data, '$.tmdb_last_season') AS INTEGER),
    tmdb_last_episode = CAST(json_extract(@data, '$.tmdb_last_episode') AS INTEGER),
    tmdb_last_air_date = json_extract(@data, '$.tmdb_last_air_date'),
    tmdb_next_season = CAST(json_extract(@data, '$.tmdb_next_season') AS INTEGER),
    tmdb_next_episode = CAST(json_extract(@data, '$.tmdb_next_episode') AS INTEGER),
    tmdb_next_air_date = json_extract(@data, '$.tmdb_next_air_date'),
    tmdb_target_season_episodes = CAST(json_extract(@data, '$.tmdb_target_season_episodes') AS INTEGER),
    tmdb_last_synced_at = json_extract(@data, '$.tmdb_last_synced_at'),
    schedule_state = json_extract(@data, '$.schedule_state'),
    tmdb_new_season_available = CASE WHEN COALESCE(CAST(json_extract(@data, '$.tmdb_new_season_available') AS INTEGER), tmdb_new_season_available) <> 0 THEN 1 ELSE 0 END
WHERE rowid = @rowid;";
    }

    static void ValidatePayload(TableSpec spec, JsonElement root)
    {
        if (spec == Subscriptions)
        {
            RequiredJsonText(root, "id", "translation_subscription_id_required");
            return;
        }

        if (spec == Progress)
            RequiredJsonText(root, "subscription_id", "translation_progress_subscription_required");
    }

    static string RequiredJsonText(JsonElement root, string name, string error)
    {
        if (!root.TryGetProperty(name, out JsonElement value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            throw new DatabaseEditorValidationException(error);

        string text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        text = (text ?? string.Empty).Trim();
        if (text.Length == 0)
            throw new DatabaseEditorValidationException(error);
        if (text.Length > MaxKeyLength)
            throw new DatabaseEditorValidationException("key_too_long");
        return text;
    }

    static async Task<(string uid, string id)?> ReadSubscriptionIdentityAsync(SqliteConnection connection, SqliteTransaction transaction, long rowid)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT uid, id FROM subscriptions WHERE rowid = @rowid LIMIT 1;";
        command.Parameters.AddWithValue("@rowid", rowid);

        await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SingleRow);
        if (!await reader.ReadAsync())
            return null;
        return (ReadString(reader, 0), ReadString(reader, 1));
    }

    static async Task DeleteProgressForSubscriptionAsync(SqliteConnection connection, SqliteTransaction transaction, string uid, string subscriptionId)
    {
        if (string.IsNullOrWhiteSpace(uid) || string.IsNullOrWhiteSpace(subscriptionId))
            return;

        await using var cleanup = connection.CreateCommand();
        cleanup.Transaction = transaction;
        cleanup.CommandText = "DELETE FROM profile_progress WHERE uid = @uid AND subscription_id = @subscriptionId;";
        cleanup.Parameters.AddWithValue("@uid", uid);
        cleanup.Parameters.AddWithValue("@subscriptionId", subscriptionId);
        await cleanup.ExecuteNonQueryAsync();
    }

    static async Task ValidateBackupAsync(string sourcePath)
    {
        try
        {
            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = sourcePath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false
            };
            await using var connection = new SqliteConnection(builder.ToString());
            await connection.OpenAsync();

            await using (var integrity = connection.CreateCommand())
            {
                integrity.CommandText = "PRAGMA quick_check;";
                if (!string.Equals(Convert.ToString(await integrity.ExecuteScalarAsync()), "ok", StringComparison.OrdinalIgnoreCase))
                    throw new DatabaseEditorValidationException("backup_integrity_failed");
            }

            foreach (string table in new[] { "settings", "subscriptions", "profile_progress" })
            {
                await using var schema = connection.CreateCommand();
                schema.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = @table LIMIT 1;";
                schema.Parameters.AddWithValue("@table", table);
                if (await schema.ExecuteScalarAsync() == null)
                    throw new DatabaseEditorValidationException("backup_schema_mismatch");
            }
        }
        catch (SqliteException)
        {
            throw new DatabaseEditorValidationException("invalid_backup_database");
        }
    }

    static async Task<string> CreateBackupLockedAsync(string marker)
    {
        Directory.CreateDirectory(BackupDirectory);
        string destinationPath = Path.Combine(BackupDirectory, $"translationsub-{marker}-{DateTime.Now:yyyyMMdd-HHmmssfff}.sql");

        await using var source = await OpenAsync();
        await EnsureSchemaAsync(source);

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = destinationPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false
        };
        await using var destination = new SqliteConnection(builder.ToString());
        await destination.OpenAsync();
        source.BackupDatabase(destination);
        return destinationPath.Replace('\\', '/');
    }

    static string ValidateKey(string value, string error)
    {
        value = (value ?? string.Empty).Trim();
        if (value.Length == 0)
            throw new DatabaseEditorValidationException(error);
        if (value.Length > MaxKeyLength)
            throw new DatabaseEditorValidationException("key_too_long");
        return value;
    }

    static string NormalizeJson(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new DatabaseEditorValidationException("data_required");
        if (Encoding.UTF8.GetByteCount(value) > MaxDataBytes)
            throw new DatabaseEditorValidationException("data_too_large");

        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new DatabaseEditorValidationException("data_must_be_json_object");
            return JsonSerializer.Serialize(document.RootElement);
        }
        catch (JsonException)
        {
            throw new DatabaseEditorValidationException("invalid_json");
        }
    }

    static string BuildPreview(string value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;
        string preview = value.Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
        while (preview.Contains("  ", StringComparison.Ordinal))
            preview = preview.Replace("  ", " ", StringComparison.Ordinal);
        return preview.Length <= 240 ? preview : preview.Substring(0, 240) + "…";
    }

    static string ReadString(SqliteDataReader reader, int index)
        => reader.IsDBNull(index) ? null : reader.GetString(index);
}
