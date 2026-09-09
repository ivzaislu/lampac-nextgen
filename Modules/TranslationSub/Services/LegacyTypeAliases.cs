global using VoiceProviderQuery = TranslationSub.Models.TranslationMetadataQuery;
global using TranslationProviderHub = TranslationSub.Services.LampacMetadataService;

// Kept only so older TranslationSub source files with `using TranslationSub.Providers`
// continue to compile while the alpha removes the provider layer itself.
namespace TranslationSub.Providers { }
