using System.Collections.Generic;
using System.Threading.Tasks;
using TranslationSub.Models;

namespace TranslationSub.Providers;

public class VoiceProviderQuery
{
    public string ImdbId { get; set; }
    public long KpId { get; set; }
    public string Title { get; set; }
    public string OriginalTitle { get; set; }
    public int Year { get; set; }
    public bool IsSerial { get; set; }
    public int Season { get; set; }
}

public interface IVoiceProvider
{
    string Source { get; }
    string Path { get; }

    Task<List<TranslationVariant>> GetVariants(VoiceProviderQuery query);
}
