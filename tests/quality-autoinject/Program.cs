using System;
using System.Text;
using Quality;
using Shared.Models.Events;

var previous = ModInit.conf;
try
{
    ModInit.conf = new ModuleConf { enable = true, autoinject = true };
    var app = new StringBuilder("/*lampa*/");
    var replace = new EventAppReplace(app, null, "lampa", "https://example.org", null, null);
    var result = ModInit.AppReplace("appjs", replace);
    if (!ReferenceEquals(result, app) || !result.ToString().Contains("https://example.org/quality.js"))
        throw new Exception("Quality autoinject URL not appended to Lampa app");
    if (!result.ToString().Contains("__qualityAutoLoad"))
        throw new Exception("Duplicate-injection guard missing");

    var css = new StringBuilder("/*css*/");
    ModInit.AppReplace("appcss", replace with { bulder = css });
    if (css.ToString() != "/*css*/")
        throw new Exception("Non-JS response was modified");

    ModInit.conf.autoinject = false;
    var disabled = new StringBuilder("/*disabled*/");
    ModInit.AppReplace("appjs", replace with { bulder = disabled });
    if (disabled.ToString() != "/*disabled*/")
        throw new Exception("Autoinject disabled setting ignored");

    ModInit.conf = new ModuleConf { enable = false, autoinject = true };
    var featureDisabled = new StringBuilder("/*off*/");
    ModInit.AppReplace("appjs", replace with { bulder = featureDisabled });
    if (featureDisabled.ToString() != "/*off*/")
        throw new Exception("Quality enable=false ignored");
}
finally
{
    ModInit.conf = previous;
}
Console.WriteLine("Quality AppReplace autoinject: OK");
