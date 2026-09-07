namespace TranslationSub;

public class ModuleConf
{
    public bool enable { get; set; } = true;
    public int check_interval_minutes { get; set; } = 15;
    public bool notifications { get; set; } = true;

    public bool flixcdn { get; set; } = true;
    public bool phantom { get; set; } = true;
    public bool zetflixdb { get; set; } = true;
    public bool videohub { get; set; } = true;

    public string flixcdn_host { get; set; } = "https://tarantino.factorios.live";

    public string phantom_apihost { get; set; } = "https://api.apbugall.org";
    public string phantom_linkhost { get; set; } = "https://aport-as.allarknow.online";
    public string phantom_token { get; set; } = "22c8122334d050de1bfc97bd08aa5e";

    public string zetflixdb_apihost { get; set; } = "https://54243ba5.obrut.show";
    public string videohub_host { get; set; } = "https://plapi.cdnvideohub.com";
}
