const https = require('https');
const http = require('http');

async function fetchUrl(url, options = {}, maxRedirects = 3) {
    if (maxRedirects <= 0) {
        throw new Error('Too many redirects');
    }
    
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const parsedUrl = new URL(url);
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.douyin.com/',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: 15000
        };

        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = res.headers.location.startsWith('http') ? 
                        res.headers.location : 
                        new URL(res.headers.location, url).href;
                    fetchUrl(redirectUrl, options, maxRedirects - 1)
                        .then(resolve)
                        .catch(reject);
                } else {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

async function parseDouyin(url) {
    let videoId = '';
    
    let finalUrl = url;
    if (url.includes('v.douyin.com')) {
        try {
            const result = await fetchUrl(url, { method: 'HEAD' });
            finalUrl = result.headers.location || url;
        } catch (e) {}
    }
    
    const videoIdMatch = finalUrl.match(/(\d{19})/);
    const itemIdMatch = finalUrl.match(/item_id=(\d+)/);
    
    if (videoIdMatch) {
        videoId = videoIdMatch[1];
    } else if (itemIdMatch) {
        videoId = itemIdMatch[1];
    } else {
        const idPatterns = [/video\/(\d+)/, /aweme\/detail\/(\d+)/, /group\/(\d+)/];
        for (const pattern of idPatterns) {
            const match = finalUrl.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
    }

    if (!videoId) {
        throw new Error('无法提取视频ID');
    }

    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}`;
    const result = await fetchUrl(apiUrl, {
        headers: {
            'Cookie': 'ttwid=1%7Ca3e3f2e79f5e4c3a2b1d0e9f8e7d6c5b4a3e2f1d0e9f8e7d6c5b4a3e2f1d0e9f;',
            'x-secsdk-csrf-token': '',
            'x-tt-env': '0',
            'x-tt-platform': '0'
        }
    });

    if (result.statusCode !== 200) {
        throw new Error('API请求失败');
    }

    try {
        const data = JSON.parse(result.body);
        if (data?.aweme_detail) {
            const video = data.aweme_detail.video;
            const images = data.aweme_detail.image_list;
            
            if (video) {
                let playUrl = video.play_addr?.url_list?.[0] || video.download_addr?.url_list?.[0] || '';
                if (playUrl) {
                    playUrl = playUrl.replace(/playwm/g, 'play');
                    return { type: 'video', url: playUrl, title: data.aweme_detail.desc || '抖音视频' };
                }
            }
            
            if (images && images.length > 0) {
                const imgUrls = images.map(img => img.url_list?.[0] || img.url || '').filter(Boolean);
                return { type: 'gallery', urls: imgUrls, title: data.aweme_detail.desc || '抖音图集' };
            }
        }
    } catch (e) {}

    const htmlResult = await fetchUrl(url);
    const html = htmlResult.body;

    const playAddrMatch = html.match(/"playAddr"\s*:\s*"([^"]+)"/);
    if (playAddrMatch) {
        let playUrl = playAddrMatch[1];
        playUrl = playUrl.replace(/playwm/g, 'play');
        return { type: 'video', url: playUrl, title: '抖音视频' };
    }

    const downloadAddrMatch = html.match(/"downloadAddr"\s*:\s*"([^"]+)"/);
    if (downloadAddrMatch) {
        let videoUrl = downloadAddrMatch[1];
        videoUrl = videoUrl.replace(/playwm/g, 'play');
        return { type: 'video', url: videoUrl, title: '抖音视频' };
    }

    throw new Error('未能提取视频地址');
}

async function parseXiaohongshu(url) {
    const noteIdMatch = url.match(/note\/(\d+)/);
    if (!noteIdMatch) {
        throw new Error('无法识别小红书笔记ID');
    }
    
    const noteId = noteIdMatch[1];
    const apiUrl = `https://www.xiaohongshu.com/api/sns/web/v1/note/detail?note_id=${noteId}`;
    
    const result = await fetchUrl(apiUrl, {
        headers: {
            'Cookie': 'a1=1',
            'x-sign': '',
            'x-trace-id': ''
        }
    });

    if (result.statusCode === 200) {
        try {
            const data = JSON.parse(result.body);
            if (data?.data?.note) {
                const note = data.data.note;
                const images = note.images || [];
                const video = note.video;
                
                if (video) {
                    return { type: 'video', url: video.url, title: note.title || '小红书视频' };
                }
                
                if (images.length > 0) {
                    const imgUrls = images.map(img => img.urls?.original || img.url || '').filter(Boolean);
                    return { type: 'gallery', urls: imgUrls, title: note.title || '小红书图集' };
                }
            }
        } catch (e) {}
    }

    const htmlResult = await fetchUrl(url);
    const html = htmlResult.body;

    const dataMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*([^;]+)/);
    if (dataMatch) {
        try {
            const state = JSON.parse(dataMatch[1]);
            const note = state?.note?.noteDetail;
            if (note) {
                const images = note.images || [];
                const video = note.video;
                
                if (video) {
                    return { type: 'video', url: video.url, title: note.title || '小红书视频' };
                }
                
                if (images.length > 0) {
                    const imgUrls = images.map(img => img.urls?.original || img.url || '').filter(Boolean);
                    return { type: 'gallery', urls: imgUrls, title: note.title || '小红书图集' };
                }
            }
        } catch (e) {}
    }

    throw new Error('未能提取小红书内容');
}

async function parseKuaishou(url) {
    const photoIdMatch = url.match(/photo\/(\d+)/);
    if (!photoIdMatch) {
        throw new Error('无法识别快手视频ID');
    }
    
    const photoId = photoIdMatch[1];
    const apiUrl = `https://www.kuaishou.com/graphql`;
    
    const result = await fetchUrl(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': 'kpf=PC_WEB; kpn=KUAISHOU;',
            'csrf': ''
        },
        body: JSON.stringify({
            operationName: "visionVideoDetail",
            query: `query visionVideoDetail($photoId: String) {
                visionVideoDetail(photoId: $photoId) {
                    photo {
                        id
                        caption
                        videoUrl
                        coverUrl
                        images { url }
                    }
                }
            }`,
            variables: { photoId }
        })
    });

    if (result.statusCode === 200) {
        try {
            const data = JSON.parse(result.body);
            if (data?.data?.visionVideoDetail?.photo) {
                const photo = data.data.visionVideoDetail.photo;
                
                if (photo.videoUrl) {
                    return { type: 'video', url: photo.videoUrl, title: photo.caption || '快手视频' };
                }
                
                if (photo.images && photo.images.length > 0) {
                    const imgUrls = photo.images.map(img => img.url).filter(Boolean);
                    return { type: 'gallery', urls: imgUrls, title: photo.caption || '快手图集' };
                }
            }
        } catch (e) {}
    }

    const htmlResult = await fetchUrl(url);
    const html = htmlResult.body;

    const videoMatch = html.match(/"videoUrl"\s*:\s*"([^"]+)"/);
    if (videoMatch) {
        return { type: 'video', url: videoMatch[1], title: '快手视频' };
    }

    throw new Error('未能提取快手视频地址');
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const { url } = req.query;
        if (!url) {
            res.status(400).json({ error: '缺少URL参数' });
            return;
        }

        let result;
        if (url.includes('douyin.com') || url.includes('v.douyin.com')) {
            result = await parseDouyin(url);
        } else if (url.includes('xiaohongshu.com')) {
            result = await parseXiaohongshu(url);
        } else if (url.includes('kuaishou.com') || url.includes('v.kuaishou.com')) {
            result = await parseKuaishou(url);
        } else {
            res.status(400).json({ error: '不支持的平台' });
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};