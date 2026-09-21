using System.Collections.Generic;

namespace VkSeries;

public class Root
{
    public Response response { get; set; }
    public VkError error { get; set; }
}

public class Response
{
    public List<CatalogVideo> catalog_videos { get; set; }
    public List<Video> videos { get; set; }
    public Catalog catalog { get; set; }
    public CatalogSection section { get; set; }
}

public class Catalog
{
    public string default_section { get; set; }
    public List<CatalogSection> sections { get; set; }
}

public class CatalogSection
{
    public string id { get; set; }
    public string next_from { get; set; }
}

public class VkError
{
    public int error_code { get; set; }
    public string error_msg { get; set; }
}

public class CatalogVideo
{
    public Video video { get; set; }
}

public class Video
{
    public long id { get; set; }
    public long owner_id { get; set; }
    public string title { get; set; }
    public string description { get; set; }
    public long duration { get; set; }
    public long? views { get; set; }
    public VideoFiles files { get; set; }
    public VideoSubtitle[] subtitles { get; set; }
}

public class VideoFiles
{
    public string mp4_144 { get; set; }
    public string mp4_240 { get; set; }
    public string mp4_360 { get; set; }
    public string mp4_480 { get; set; }
    public string mp4_720 { get; set; }
    public string mp4_1080 { get; set; }
    public string mp4_1440 { get; set; }
    public string mp4_2160 { get; set; }
    public string hls { get; set; }
    public string hls_fmp4 { get; set; }
}

public class VideoSubtitle
{
    public string lang { get; set; }
    public string title { get; set; }
    public bool is_auto { get; set; }
    public string url { get; set; }
    public string manifest_name { get; set; }
}
