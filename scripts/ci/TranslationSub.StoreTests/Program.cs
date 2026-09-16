using Microsoft.Data.Sqlite;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using TranslationSub.Models;
using TranslationSub.Services;

internal static class Program
{
    static readonly DateTime CreatedAt = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    static int Main()
    {
        var tests = new (string Name, Action Body)[]
        {
            ("updates only the changed subscription", UpdateOneSubscription),
            ("inserts only the new subscription", AddSubscription),
            ("deletes one subscription and its profile progress", DeleteSubscription),
            ("changes uid and cleans progress owned by the old uid", ChangeUid),
            ("rolls back cleanup/delete/update when a later insert fails", RollbackWholeTransaction),
        };

        int failed = 0;
        foreach (var test in tests)
        {
            try
            {
                test.Body();
                Console.WriteLine($"[PASS] {test.Name}");
            }
            catch (Exception ex)
            {
                failed++;
                Console.Error.WriteLine($"[FAIL] {test.Name}: {ex}");
            }
        }

        Console.WriteLine($"TranslationSub SubscriptionStore tests: {tests.Length - failed}/{tests.Length} passed");
        return failed == 0 ? 0 : 1;
    }

    static void UpdateOneSubscription()
    {
        ResetDatabase();
        Seed(Sub("a", "uid-a", "Alpha", 1), Sub("b", "uid-b", "Beta", 2));
        InstallAuditTriggers();
        TranslationSubRealtimeService.Reset();

        SubscriptionStore.Mutate(list =>
        {
            var item = list.Single(x => x.Id == "a");
            item.LastEpisode = 7;
        });

        AssertAudit(("update", "a"));
        AssertEqual(7, ReadInt("SELECT last_episode FROM subscriptions WHERE id = 'a'"), "updated episode");
        AssertEqual(2, ReadInt("SELECT last_episode FROM subscriptions WHERE id = 'b'"), "untouched episode");
        AssertIntegrity();
    }

    static void AddSubscription()
    {
        ResetDatabase();
        Seed(Sub("a", "uid-a", "Alpha", 1));
        InstallAuditTriggers();
        TranslationSubRealtimeService.Reset();

        SubscriptionStore.Mutate(list => list.Add(Sub("b", "uid-b", "Beta", 3)));

        AssertAudit(("insert", "b"));
        AssertEqual(2, ReadInt("SELECT COUNT(*) FROM subscriptions"), "subscription count after insert");
        AssertEqual("Beta", ReadText("SELECT title FROM subscriptions WHERE id = 'b'"), "inserted title");
        AssertIntegrity();
    }

    static void DeleteSubscription()
    {
        ResetDatabase();
        Seed(Sub("a", "uid-a", "Alpha", 1), Sub("b", "uid-b", "Beta", 2));
        AddProgress("uid-a", "a", 1);
        AddProgress("uid-b", "b", 2);
        InstallAuditTriggers();
        TranslationSubRealtimeService.Reset();

        SubscriptionStore.Mutate(list => list.RemoveAll(x => x.Id == "b"));

        AssertAudit(("delete", "b"));
        AssertEqual(0, ReadInt("SELECT COUNT(*) FROM subscriptions WHERE id = 'b'"), "deleted subscription");
        AssertEqual(0, ReadInt("SELECT COUNT(*) FROM profile_progress WHERE subscription_id = 'b'"), "deleted profile progress");
        AssertEqual(1, ReadInt("SELECT COUNT(*) FROM profile_progress WHERE subscription_id = 'a'"), "unrelated profile progress");
        AssertIntegrity();
    }

    static void ChangeUid()
    {
        ResetDatabase();
        Seed(Sub("a", "uid-old", "Alpha", 1));
        AddProgress("uid-old", "a", 1);
        InstallAuditTriggers();
        TranslationSubRealtimeService.Reset();

        SubscriptionStore.Mutate(list => list.Single(x => x.Id == "a").Uid = "uid-new");

        AssertAudit(("update", "a"));
        AssertEqual("uid-new", ReadText("SELECT uid FROM subscriptions WHERE id = 'a'"), "new uid");
        AssertEqual(0, ReadInt("SELECT COUNT(*) FROM profile_progress WHERE uid = 'uid-old' AND subscription_id = 'a'"), "old uid progress cleanup");

        var published = TranslationSubRealtimeService.Published().Select(x => x.Uid).ToHashSet(StringComparer.Ordinal);
        Assert(published.SetEquals(new[] { "uid-old", "uid-new" }), "uid change must invalidate both old and new realtime projections");
        AssertIntegrity();
    }

    static void RollbackWholeTransaction()
    {
        ResetDatabase();
        Seed(Sub("a", "uid-a", "Alpha", 1), Sub("b", "uid-b", "Beta", 2));
        AddProgress("uid-b", "b", 2);
        InstallAuditTriggers();
        InstallFailingInsertTrigger();
        TranslationSubRealtimeService.Reset();

        bool threw = false;
        try
        {
            SubscriptionStore.Mutate(list =>
            {
                list.Single(x => x.Id == "a").Title = "Alpha changed";
                list.RemoveAll(x => x.Id == "b");
                list.Add(Sub("boom", "uid-boom", "__FAIL_INSERT__", 1));
            });
        }
        catch (SqliteException)
        {
            threw = true;
        }

        Assert(threw, "forced insert failure must escape SubscriptionStore.Mutate");
        AssertEqual("Alpha", ReadText("SELECT title FROM subscriptions WHERE id = 'a'"), "updated row must roll back");
        AssertEqual(1, ReadInt("SELECT COUNT(*) FROM subscriptions WHERE id = 'b'"), "deleted row must roll back");
        AssertEqual(1, ReadInt("SELECT COUNT(*) FROM profile_progress WHERE uid = 'uid-b' AND subscription_id = 'b'"), "profile cleanup must roll back");
        AssertEqual(0, ReadInt("SELECT COUNT(*) FROM subscriptions WHERE id = 'boom'"), "failed insert must not persist");
        AssertEqual(0, ReadInt("SELECT COUNT(*) FROM subscription_audit"), "audit writes from rolled-back operations must also roll back");
        AssertEqual(0, TranslationSubRealtimeService.Published().Length, "failed transaction must not publish realtime changes");
        AssertIntegrity();
    }

    static void ResetDatabase()
    {
        string directory = Path.Combine(Path.GetTempPath(), "translationsub-subscription-store-tests");
        string path = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".db");
        TranslationSubDatabase.Reset(path);
        TranslationSubRealtimeService.Reset();
    }

    static TranslationSubscription Sub(string id, string uid, string title, int episode)
    {
        return new TranslationSubscription
        {
            Id = id,
            Uid = uid,
            ContentId = "content-" + id,
            Title = title,
            OriginalTitle = title,
            TmdbId = id == "a" ? "1001" : id == "b" ? "1002" : "1003",
            IsSerial = true,
            Source = "test",
            TranslationId = "voice",
            TranslationName = "Voice",
            CurrentSeason = 1,
            LastSeason = 1,
            LastEpisode = episode,
            Sources = new List<TranslationSubscriptionSource>
            {
                new() { Source = "test", TranslationId = "voice", TranslationName = "Voice" }
            },
            CreatedAt = CreatedAt,
            LastCheckedAt = CreatedAt,
            ScheduleState = "active_dubbing"
        };
    }

    static void Seed(params TranslationSubscription[] subscriptions)
    {
        SubscriptionStore.Mutate(list => list.AddRange(subscriptions));
        TranslationSubRealtimeService.Reset();
    }

    static void AddProgress(string uid, string subscriptionId, int watched)
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = @"
INSERT INTO profile_progress (uid, profile_id, subscription_id, watched_episode, updated_at)
VALUES ($uid, '0', $subscription_id, $watched_episode, $updated_at);";
        command.Parameters.AddWithValue("$uid", uid);
        command.Parameters.AddWithValue("$subscription_id", subscriptionId);
        command.Parameters.AddWithValue("$watched_episode", watched);
        command.Parameters.AddWithValue("$updated_at", TranslationSubDatabase.DateTimeText(CreatedAt));
        command.ExecuteNonQuery();
    }

    static void InstallAuditTriggers()
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = @"
CREATE TRIGGER audit_subscription_insert AFTER INSERT ON subscriptions
BEGIN
    INSERT INTO subscription_audit(action, id) VALUES ('insert', NEW.id);
END;
CREATE TRIGGER audit_subscription_update AFTER UPDATE ON subscriptions
BEGIN
    INSERT INTO subscription_audit(action, id) VALUES ('update', NEW.id);
END;
CREATE TRIGGER audit_subscription_delete AFTER DELETE ON subscriptions
BEGIN
    INSERT INTO subscription_audit(action, id) VALUES ('delete', OLD.id);
END;";
        command.ExecuteNonQuery();
    }

    static void InstallFailingInsertTrigger()
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = @"
CREATE TRIGGER fail_subscription_insert BEFORE INSERT ON subscriptions
WHEN NEW.title = '__FAIL_INSERT__'
BEGIN
    SELECT RAISE(ABORT, 'forced SubscriptionStore test failure');
END;";
        command.ExecuteNonQuery();
    }

    static void AssertAudit(params (string Action, string Id)[] expected)
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT action, id FROM subscription_audit ORDER BY rowid";
        using var reader = command.ExecuteReader();
        var actual = new List<(string Action, string Id)>();
        while (reader.Read())
            actual.Add((reader.GetString(0), reader.GetString(1)));

        AssertEqual(expected.Length, actual.Count, "audit operation count");
        for (int i = 0; i < expected.Length; i++)
            Assert(expected[i] == actual[i], $"audit[{i}] expected {expected[i]}, got {actual[i]}");
    }

    static int ReadInt(string sql)
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt32(command.ExecuteScalar());
    }

    static string ReadText(string sql)
    {
        using var connection = TranslationSubDatabase.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(command.ExecuteScalar());
    }

    static void AssertIntegrity()
    {
        AssertEqual("ok", ReadText("PRAGMA integrity_check"), "SQLite integrity_check");
    }

    static void Assert(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }

    static void AssertEqual<T>(T expected, T actual, string message)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{message}: expected '{expected}', got '{actual}'");
    }
}
