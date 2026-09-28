#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Microsoft.Extensions.Logging;
using QRAuth.Models;

namespace QRAuth.Services
{
    /// <summary>Access to the shared users.json. Reads are used for the QR-confirm lookup and
    /// the admin /users listing; AddUser/RevokeByToken back the grant/revoke bot flows. Anything
    /// else about a record (editing group/expiry by hand) is still done by hand.</summary>
    public class UsersRepository
    {
        static readonly object _writeLock = new();

        // default JSON encoder escapes Cyrillic (and most non-ASCII) as \uXXXX — unreadable
        // when someone opens users.json by hand to check a comment
        static readonly JsonSerializerOptions _writeOptions = new()
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.Create(UnicodeRanges.BasicLatin, UnicodeRanges.Cyrillic)
        };

        readonly string _path;
        readonly ILogger<UsersRepository> _logger;

        public UsersRepository(string path, ILogger<UsersRepository> logger)
        {
            _path = path;
            _logger = logger;
        }

        public List<LampacUser> ReadAll()
        {
            // shares _writeLock with Add/RevokeByToken/UnbanByToken so a read never lands
            // mid File.WriteAllText and sees a truncated file (Monitor is reentrant, so a
            // write's own ReadAll-then-mutate-then-write nests fine on the same thread)
            lock (_writeLock)
            {
                try
                {
                    if (!File.Exists(_path)) return new();
                    var json = File.ReadAllText(_path);
                    return JsonSerializer.Deserialize<List<LampacUser>>(json) ?? new();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[TelegramBot] ReadUsers error");
                    return new();
                }
            }
        }

        public LampacUser? GetByTgId(long tgId) =>
            ReadAll().FirstOrDefault(u => u.TgId == tgId);

        public LampacUser? GetByToken(string token) =>
            ReadAll().FirstOrDefault(u => u.Id == token);

        // Lampac core's Accsdb middleware still gates access on `expires` (see
        // lampac/Core/Middlewares/Accsdb.cs) — it's not a field we can drop from the record.
        // We just stop offering any control over it: every grant gets this fixed far-future
        // value, so the only thing that can ever end access is Ban (RevokeByToken).
        static readonly string NoExpiry = DateTime.UtcNow.AddYears(100).ToString("O");

        /// <summary>
        /// Grants access to a Telegram account.
        ///
        /// Telegram id is the account key inside QRAuth: once a tg_id receives a random Lampac
        /// token, that token is kept permanently and reused on every device. This is important
        /// because Lampac Sync/History is keyed by the accsdb id. Regenerating the token for the
        /// same Telegram user would make Lampac see a brand-new account with empty history.
        ///
        /// The Telegram id itself is never used as the login password: it is public/predictable,
        /// while Id remains a random secret credential.
        /// </summary>
        public string AddUser(long tgId, string comment)
        {
            if (tgId <= 0)
                throw new ArgumentOutOfRangeException(nameof(tgId));

            lock (_writeLock)
            {
                var users = ReadAll();
                var matches = users.Where(u => u.TgId == tgId).ToList();
                var user = matches.FirstOrDefault();

                if (user == null)
                {
                    user = new LampacUser
                    {
                        Id = GenerateToken(),
                        TgId = tgId,
                        Group = 1,
                        Expires = NoExpiry,
                        Comment = comment,
                        Ban = false,
                        BanMsg = ""
                    };

                    users.Add(user);
                }
                else
                {
                    // Keep the original credential so all devices and all Sync data continue
                    // to belong to the same Lampac account.
                    if (string.IsNullOrWhiteSpace(user.Id))
                        user.Id = GenerateToken();

                    user.Comment = comment;
                    user.Ban = false;
                    user.BanMsg = "";

                    // Older/custom builds could leave duplicate rows for one Telegram account.
                    // QRAuth always resolves GetByTgId to the first row, so keep exactly that
                    // canonical row and remove the rest.
                    foreach (var duplicate in matches.Skip(1))
                        users.Remove(duplicate);
                }

                File.WriteAllText(_path, JsonSerializer.Serialize(users, _writeOptions));
                return user.Id;
            }
        }

        /// <summary>Blocks access by setting ban=true on the record with this exact token (the
        /// "id" field — i.e. the login password), not by deleting the row. Deleting doesn't
        /// work: Lampac's own 1s users.json poller (Program.cs:UpdateUsersDb) only ever upserts
        /// into its in-memory user cache, it never prunes an entry whose row disappeared — so a
        /// removed user stays cached as authorized, still logged in, until the process restarts.
        /// Flipping ban=true on the EXISTING row is what actually mutates that same cached
        /// object in place, which the Accsdb middleware then denies on the very next request.
        /// Keyed by token, not tg_id: hand-added accounts (family members with no Telegram of
        /// their own) can all share tg_id=0, so tg_id alone can't pick out a single record.
        /// Returns false if there was nothing to block.</summary>
        public bool RevokeByToken(string token)
        {
            lock (_writeLock)
            {
                var users = ReadAll();
                var user = users.FirstOrDefault(u => u.Id == token);
                if (user == null)
                    return false;

                user.Ban = true;
                user.BanMsg = "Доступ заблокирован администратором";

                File.WriteAllText(_path, JsonSerializer.Serialize(users, _writeOptions));
                return true;
            }
        }

        /// <summary>Reverses RevokeByToken — clears ban so the same cached-mutation path
        /// restores access on Lampac's next ~1s poll. Returns false if there was nothing to
        /// unblock.</summary>
        public bool UnbanByToken(string token)
        {
            lock (_writeLock)
            {
                var users = ReadAll();
                var user = users.FirstOrDefault(u => u.Id == token);
                if (user == null)
                    return false;

                user.Ban = false;
                user.BanMsg = "";

                File.WriteAllText(_path, JsonSerializer.Serialize(users, _writeOptions));
                return true;
            }
        }

        static string GenerateToken()
        {
            Span<byte> bytes = stackalloc byte[9];
            RandomNumberGenerator.Fill(bytes);
            return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }
    }
}
