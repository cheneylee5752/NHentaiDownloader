var Parsing = ParsingApi;

chrome.tabs.onUpdated.addListener(function
    (_, changeInfo, _) {
        if (changeInfo.url !== undefined)
            setIcon(changeInfo.url);
    }
);

chrome.tabs.onActivated.addListener(function() {
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function (tabs) {
        setIcon(tabs[0].url);
    });
});

function setIcon(url) {
    if (url.startsWith("https://nhentai.net"))
        chrome.browserAction.setIcon({path: "Icon.png"});
    else
        chrome.browserAction.setIcon({path: "Icon-grey.png"});
}

var progressFunction;
var doujinshiName;
var currProgress = 100;

function updateProgress(progress, downloadAtEnd) {
    progressFunction = progress;
    progressFunction(currProgress, doujinshiName, downloadAtEnd);
}

function goBack() {
    currProgress = -1;
}

function isDownloadFinished() {
    return (currProgress === 100);
}

function downloadDoujinshi(json, path, errorCb, progress, name) {
    let zip = new JSZip();
    zip.folder(path);
    download(json, path, errorCb, progress, name, zip, true);
}

function downloadDoujinshiInternal(zip, length, allDoujinshis, path, errorCb, progress, i, allKeys) {
    let key = allKeys[i];
    let http = new XMLHttpRequest();
    http.onreadystatechange = function() {
        if (this.readyState === 4) {
            if (this.status === 200) {
                let json = JSON.parse(Parsing.GetJson(this.responseText));
                chrome.storage.sync.get({
                    displayName: "pretty"
                }, function(elems) {
                    let title;
                    if (elems.displayName == "pretty") {
                        if (json.title.pretty === "") {
                            title = json.title.english.replace(/\[[^\]]+\]/g, '').replace(/\([^\)]+\)/g, '');
                        } else {
                            title = json.title.pretty;
                        }
                    } else if (elems.displayName === "english") {
                        title = json.title.english;
                    } else {
                        title = json.title.japanese;
                    }
                    zip.folder(cleanName(title));
                    download(json, cleanName(title), errorCb, progress, allDoujinshis[key], zip, length === i + 1, path, function() {
                        downloadDoujinshiInternal(zip, length, allDoujinshis, path, errorCb, progress, i + 1, allKeys);
                    });
                });
            } else {
                errorCb("Can't download " + key + " (Code " + this.status + ").");
                return;
            }
        }
    };
    http.open("GET", Parsing.GetUrl(key), true);
    http.send();
}

function downloadAllDoujinshis(allDoujinshis, path, errorCb, progress) {
    let zip = new JSZip();
    let length = Object.keys(allDoujinshis).length;
    downloadDoujinshiInternal(zip, length, allDoujinshis, path, errorCb, progress, 0, Object.keys(allDoujinshis));
}

function getNumberWithZeros(nb) {
    if (nb < 10) return '00' + nb;
    else if (nb < 100) return '0' + nb;
    return nb;
}

function downloadPageInternal(json, path, errorCb, zip, downloadAtEnd, saveName, currName, totalNumber, downloaded, mediaId, next) {
    chrome.storage.sync.get({
        useZip: "zip"
    }, function(elems) {
        let page = json.images.pages[downloaded];
        let format;
        if (page.t === "j") format = '.jpg';
        else if (page.t === "p") format = '.png';
        else format = '.gif';
        let filenameParsing = (parseInt(downloaded) + 1) + format; // Name for parsing
        let filename = getNumberWithZeros(parseInt(downloaded) + 1) + format; // Final file name
        if (elems.useZip !== "raw") {
            fetch('https://i.nhentai.net/galleries/' + mediaId + '/' + filenameParsing)
            .then(function(response) {
                if (response.status === 200) {
                    return (response.blob());
                } else {
                    throw new Error("Failed to fetch doujinshi page (status " + response.status + "), if the error persist please report it.");
                }
            })
            .then(function(blob) {
                let reader = new FileReader();
                reader.addEventListener("loadend", function() {
                    zip.file(path + '/' + filename, reader.result);
                    if (currProgress !== -1 && doujinshiName === currName) {
                        downloaded++;
                        currProgress = downloaded * 100 / totalNumber;
                        progressFunction(currProgress, doujinshiName, downloadAtEnd);
                    }
                    if (downloaded === totalNumber)
                    {
                        if (downloadAtEnd) {
                            zip.generateAsync({type:"blob"})
                            .then(function(content) {
                                if (elems.useZip == "zip")
                                    saveAs(content, saveName + ".zip");
                                else
                                    saveAs(content, saveName + ".cbz");
                            });
                        } else if (next !== undefined) {
                            next();
                        }
                    } else {
                        downloadPageInternal(json, path, errorCb, zip, downloadAtEnd, saveName, currName, totalNumber, downloaded, mediaId, next);
                    }
                });
                reader.readAsArrayBuffer(blob);
            })
            .catch((error) => {
                currProgress = 100;
                errorCb(error);
            });
        } else { // We don't need to update progress here because it go too fast anyway (since it just need to launch download)
            chrome.downloads.download({
                url: 'https://i.nhentai.net/galleries/' + mediaId + '/' + filenameParsing,
                filename: './' + path + filename
            }, function(downloadId) {
                if (downloadId === undefined) {
                    currProgress = 100;
                    errorCb("Failed to download doujinshi page (" + chrome.runtime.lastError + "), if the error persist please report it.");
                }
            });
            downloaded++;
            if (downloaded !== totalNumber) {
                downloadPageInternal(json, path, errorCb, zip, downloadAtEnd, saveName, currName, totalNumber, downloaded, mediaId, next);
            } else if (!downloadAtEnd && next !== undefined) {
                next();
            }
        }
    });
}

function download(json, path, errorCb, progress, name, zip, downloadAtEnd, saveName = path, next = undefined) {
    progressFunction = progress;
    doujinshiName = name;
    let currName = name;
    let totalNumber = json.images.pages.length;
    let downloaded = 0;
    let mediaId = json.media_id;
    currProgress = 0;
    chrome.storage.sync.get({
        useZip: "zip"
    }, function(elems) {
        if (elems.useZip === "raw") {
            currProgress = 100;
            progressFunction(currProgress, doujinshiName, true);
        }
    });
    downloadPageInternal(json, path, errorCb, zip, downloadAtEnd, saveName, currName, totalNumber, downloaded, mediaId, next);
}