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
    public List<VideoAlbum> albums { get; set; }
    public List<Video> videos { get; set; }
    public List<VkGroup> groups { get; set; }
    public CatalogSection section { get; set; }
    public CatalogContainer catalog { get; set; }
}

public class CatalogContainer
{
    public List<CatalogSection> sections { get; set; }
}

public class CatalogSection
{
    public string id { get; set; }
    public string next_from { get; set; }
}

public class VkGroup
{
    public long id { get; set; }
    public string name { get; set; }
    public string screen_name { get; set; }
}

public class VideoAlbum
{
    public long id { get; set; }
    public long owner_id { get; set; }
    public string title { get; set; }
    public int count { get; set; }
    public int type { get; set; }
    public long? updated_time { get; set; }
    public SeriesObject series_object { get; set; }

    public int season { get; set; }
    public bool context_verified { get; set; }
}

public class SeriesObject
{
    public List<SeriesSeason> seasons { get; set; }
}

public class SeriesSeason
{
    public long id { get; set; }
    public long owner_id { get; set; }
    public long series_id { get; set; }
    public string title { get; set; }
    public int count { get; set; }
}

public class SeriesPlaylist
{
    public VideoAlbum album { get; set; }
    public List<Video> videos { get; set; }
}

public class VideoAlbumsRoot
{
    public VideoAlbumsResponse response { get; set; }
    public VkError error { get; set; }
}

public class VideoAlbumsResponse
{
    public int count { get; set; }
    public List<VideoAlbum> items { get; set; }
}

public class VideoAlbumRoot
{
    public VideoAlbum response { get; set; }
    public VkError error { get; set; }
}

public class VideoFromAlbumRoot
{
    public VideoFromAlbumResponse response { get; set; }
    public VkError error { get; set; }
}

public class VideoFromAlbumResponse
{
    public int count { get; set; }
    public List<VideoFromAlbumItem> items { get; set; }
}

public class VideoFromAlbumItem
{
    public int playlist_position { get; set; }
    public Video video { get; set; }
}

public class VideoGetRoot
{
    public VideoGetResponse response { get; set; }
    public VkError error { get; set; }
}

public class VideoGetResponse
{
    public int count { get; set; }
    public List<Video> items { get; set; }
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
    public int playlist_position { get; set; }
    public string owner_name { get; set; }
    public ShortVideoInfo short_video_info { get; set; }
    public VideoFiles files { get; set; }
    public VideoSubtitle[] subtitles { get; set; }
}

public class ShortVideoInfo
{
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
    public string hls_ondemand { get; set; }
    public string hls_streams { get; set; }
    public string dash_sep { get; set; }
    public string dash_ondemand { get; set; }
    public string dash_streams { get; set; }
    public string dash_webm { get; set; }
    public string failover_host { get; set; }
}

public class VideoSubtitle
{
    public string lang { get; set; }
    public string title { get; set; }
    public bool is_auto { get; set; }
    public string url { get; set; }
    public string manifest_name { get; set; }
}
