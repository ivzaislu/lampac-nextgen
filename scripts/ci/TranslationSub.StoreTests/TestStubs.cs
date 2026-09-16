using Microsoft.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;

namespace TranslationSub.Services;

internal static class TranslationSubDatabase
{
    static string databasePath;

    public static object SyncRoot { get; } = new();

    public static void Reset(string path)
    {
        databasePath = path;
        SqliteConnection.ClearAllPools();
        if (File.Exists(path))
            File.Delete(path);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = @"
CREATE TABLE subscriptions (
    id TEXT NOT NULL PRIMARY KEY,
    uid TEXT NOT NULL,
    content_id TEXT NULL,
    title TEXT NULL,
    original_title TEXT NULL,
    kp_id TEXT NULL,
    imdb_id TEXT NULL,
    tmdb_id TEXT NULL,
    poster TEXT NULL,
    year INTEGER NULL,
    is_serial INTEGER NOT NULL,
    source TEXT NULL,
    translation_id TEXT NULL,
    translation_name TEXT NULL,
    current_season INTEGER NULL,
    last_season INTEGER NULL,
    last_episode INTEGER NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_checked_at TEXT NULL,
    tmdb_status TEXT NULL,
    tmdb_last_season INTEGER NULL,
    tmdb_last_episode INTEGER NULL,
    tmdb_last_air_date TEXT NULL,
    tmdb_next_season INTEGER NULL,
    tmdb_next_episode INTEGER NULL,
    tmdb_next_air_date TEXT NULL,
    tmdb_target_season_episodes INTEGER NULL,
    tmdb_last_synced_at TEXT NULL,
    schedule_state TEXT NULL,
    tmdb_new_season_available INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_translationsub_subscriptions_uid ON subscriptions(uid);

CREATE TABLE profile_progress (
    uid TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    watched_episode INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (uid, profile_id, subscription_id)
);
CREATE INDEX idx_translationsub_profile_progress_subscription ON profile_progress(subscription_id);

CREATE TABLE subscription_audit (
    action TEXT NOT NULL,
    id TEXT NOT NULL
);";
        command.ExecuteNonQuery();
    }

    public static SqliteConnection Open()
    {
        if (string.IsNullOrWhiteSpace(databasePath))
            throw new InvalidOperationException("Test database has not been initialized.");

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = false
        };
        var connection = new SqliteConnection(builder.ToString());
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;";
        command.ExecuteNonQuery();
        return connection;
    }

    public static string DateTimeText(DateTime value)
        => value.ToString("O", CultureInfo.InvariantCulture);

    public static object DateTimeValue(DateTime? value)
        => value.HasValue ? DateTimeText(value.Value) : DBNull.Value;

    public static DateTime ReadDateTime(SqliteDataReader reader, string column, DateTime fallback)
        => ReadNullableDateTime(reader, column) ?? fallback;

    public static DateTime? ReadNullableDateTime(SqliteDataReader reader, string column)
    {
        int ordinal = reader.GetOrdinal(column);
        if (reader.IsDBNull(ordinal))
            return null;

        string text = reader.GetString(ordinal);
        return DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var value)
            ? value
            : null;
    }

    public static string ReadNullableString(SqliteDataReader reader, string column)
    {
        int ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    public static int? ReadNullableInt(SqliteDataReader reader, string column)
    {
        int ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetInt32(ordinal);
    }
}

public static class TranslationSubRealtimeService
{
    static readonly object sync = new();
    static readonly List<(string Uid, string Reason)> published = new();

    public static Task PublishUid(string uid, string reason)
    {
        lock (sync)
            published.Add((uid, reason));
        return Task.CompletedTask;
    }

    public static void Reset()
    {
        lock (sync)
            published.Clear();
    }

    public static (string Uid, string Reason)[] Published()
    {
        lock (sync)
            return published.ToArray();
    }
}
