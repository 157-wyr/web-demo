const https = require('https');
const http = require('http');

function fetchUrl(url, options = {}) {
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
                'Accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: 20000
        };

        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end(options.body || '');
    });
}

const PARSE_APIS = [
    'https://api.toubiec.cn/douy?url=',
    'https://api.pearktrue.cn/api/video/parse/?url=',
    'https://api.yujian.vip/api/dy/parse/?url=',
    'https://api.copymanga.org/api/dy/parse/?url=',
    'https://api.r21.cc/api/dy/parse/?url='
];

async function parseWithThirdPartyApi(url) {
    for (const apiUrl of PARSE_APIS) {
        try {
            console.log('Trying API:', apiUrl);
            const result = await fetchUrl(apiUrl + encodeURIComponent(url), {
                headers: {
                    'Referer': 'https://www.douyin.com/',
                    'Origin': 'https://www.douyin.com'
                }
            });
            
            console.log('API response status:', result.statusCode);
            
            if (result.statusCode === 200) {
                try {
                    const data = JSON.parse(result.body);
                    console.log('API response:', JSON.stringify(data).substring(0, 300));
                    
                    if (data.status === true) {
                        if (data.videourl && Array.isArray(data.videourl) && data.videourl.length > 0) {
                            return { type: 'video', url: data.videourl[0], title: data.nickname || '抖音视频' };
                        }
                        if (data.image && !data.videourl) {
                            return { type: 'gallery', urls: [data.image], title: data.nickname || '抖音图集' };
                        }
                    }
                    
                    if (data.code === 200 || data.code === 0 || data.success) {
                        if (data.video) {
                            return { type: 'video', url: data.video, title: data.title || data.msg || '抖音视频' };
                        }
                        
                        if (data.images && data.images.length > 0) {
                            return { type: 'gallery', urls: data.images, title: data.title || '抖音图集' };
                        }
                        
                        const video = data.data || data.result || data;
                        
                        if (video.url) {
                            return { type: 'video', url: video.url, title: video.title || video.desc || '视频' };
                        }
                        
                        if (video.video_url || video.play_url) {
                            return { type: 'video', url: video.video_url || video.play_url, title: video.title || '视频' };
                        }
                        
                        if (video.url_list && video.url_list.length > 0) {
                            return { type: 'video', url: video.url_list[0], title: video.title || '视频' };
                        }
                        
                        if (video.images && video.images.length > 0) {
                            const imgUrls = video.images.map(img => img.url || img).filter(Boolean);
                            return { type: 'gallery', urls: imgUrls, title: video.title || '图集' };
                        }
                    }
                } catch (e) {
                    console.error('JSON parse error:', e);
                }
            }
        } catch (error) {
            console.error('API request failed:', apiUrl, error.message);
        }
    }
    throw new Error('所有解析服务均不可用');
}

async function parseDouyinDirect(url) {
    let videoId = '';
    let finalUrl = url;
    
    if (url.includes('v.douyin.com')) {
        try {
            const result = await fetchUrl(url, { method: 'GET' });
            finalUrl = result.headers.location || url;
            if (!finalUrl.startsWith('http')) {
                finalUrl = new URL(finalUrl, url).href;
            }
            console.log('Redirected to:', finalUrl);
        } catch (e) {
            console.error('Redirect failed:', e.message);
        }
    }

    const videoIdMatch = finalUrl.match(/(\d{19})/);
    const itemIdMatch = finalUrl.match(/item_id=(\d+)/);
    const videoPathMatch = finalUrl.match(/video\/(\d+)/);
    
    if (videoIdMatch) {
        videoId = videoIdMatch[1];
    } else if (itemIdMatch) {
        videoId = itemIdMatch[1];
    } else if (videoPathMatch) {
        videoId = videoPathMatch[1];
    } else {
        const idPatterns = [/aweme\/detail\/(\d+)/, /group\/(\d+)/];
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

    console.log('Video ID:', videoId);

    const htmlResult = await fetchUrl(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            'Cookie': 'ttwid=1%7C9a3c2d1e8f7b6a5c4d3e2f1a0b9c8d7e;',
            'Referer': 'https://www.douyin.com/'
        }
    });
    const html = htmlResult.body;

    console.log('HTML length:', html.length);

    const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*([^;]+)/);
    if (initialStateMatch) {
        try {
            const state = JSON.parse(initialStateMatch[1]);
            console.log('Found __INITIAL_STATE__');
            
            const videos = state?.video?.videoList || state?.awemeDetail?.videoList;
            if (videos && videos.length > 0) {
                const video = videos[0];
                let playUrl = video.playAddr?.url_list?.[0] || video.downloadAddr?.url_list?.[0] || video.video_url || '';
                if (playUrl) {
                    playUrl = playUrl.replace(/playwm/g, 'play');
                    if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
                    return { type: 'video', url: playUrl, title: video.desc || '抖音视频' };
                }
            }
        } catch (e) {
            console.error('__INITIAL_STATE__ parse error:', e.message);
        }
    }

    const playAddrMatch = html.match(/"playAddr"\s*:\s*"([^"]+)"/);
    if (playAddrMatch) {
        let playUrl = playAddrMatch[1];
        playUrl = playUrl.replace(/playwm/g, 'play');
        if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
        console.log('Found playAddr:', playUrl);
        return { type: 'video', url: playUrl, title: '抖音视频' };
    }

    const downloadAddrMatch = html.match(/"downloadAddr"\s*:\s*"([^"]+)"/);
    if (downloadAddrMatch) {
        let videoUrl = downloadAddrMatch[1];
        videoUrl = videoUrl.replace(/playwm/g, 'play');
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        console.log('Found downloadAddr:', videoUrl);
        return { type: 'video', url: videoUrl, title: '抖音视频' };
    }

    const urlListMatch = html.match(/"url_list":\[([^\]]+)\]/);
    if (urlListMatch) {
        const innerUrls = urlListMatch[1].match(/"([^"]+play[^"]+)"/g);
        if (innerUrls && innerUrls.length > 0) {
            let videoUrl = innerUrls[0].replace(/"/g, '');
            videoUrl = videoUrl.replace(/playwm/g, 'play');
            if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
            console.log('Found url_list:', videoUrl);
            return { type: 'video', url: videoUrl, title: '抖音视频' };
        }
    }

    const awemeInfoMatch = html.match(/window\.__AWEME_INFO__\s*=\s*([^;]+)/);
    if (awemeInfoMatch) {
        try {
            const awemeInfo = JSON.parse(awemeInfoMatch[1]);
            const video = awemeInfo?.video;
            if (video) {
                let playUrl = video.play_addr?.url_list?.[0] || video.download_addr?.url_list?.[0] || '';
                if (playUrl) {
                    playUrl = playUrl.replace(/playwm/g, 'play');
                    if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
                    return { type: 'video', url: playUrl, title: '抖音视频' };
                }
            }
        } catch (e) {
            console.error('__AWEME_INFO__ parse error:', e.message);
        }
    }

    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}`;
    const apiResult = await fetchUrl(apiUrl, {
        headers: {
            'Cookie': 'ttwid=1%7C9a3c2d1e8f7b6a5c4d3e2f1a0b9c8d7e;',
            'x-secsdk-csrf-token': '',
            'x-tt-env': '0',
            'x-tt-platform': '0',
            'x-bogus': 'DFSzswV84wUAN88b5y1l0w=='
        }
    });

    console.log('Douyin API status:', apiResult.statusCode);

    if (apiResult.statusCode === 200) {
        try {
            const data = JSON.parse(apiResult.body);
            console.log('Douyin API response:', JSON.stringify(data).substring(0, 500));
            
            if (data?.aweme_detail) {
                const video = data.aweme_detail.video;
                const images = data.aweme_detail.image_list;
                
                if (video) {
                    let playUrl = video.play_addr?.url_list?.[0] || video.download_addr?.url_list?.[0] || '';
                    if (playUrl) {
                        playUrl = playUrl.replace(/playwm/g, 'play');
                        if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
                        return { type: 'video', url: playUrl, title: data.aweme_detail.desc || '抖音视频' };
                    }
                }
                
                if (images && images.length > 0) {
                    const imgUrls = images.map(img => img.url_list?.[0] || img.url || '').filter(Boolean);
                    return { type: 'gallery', urls: imgUrls, title: data.aweme_detail.desc || '抖音图集' };
                }
            }
        } catch (e) {
            console.error('Douyin JSON parse error:', e);
        }
    }

    throw new Error('未能提取视频地址');
}

async function parseXiaohongshuDirect(url) {
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

    throw new Error('未能提取小红书内容');
}

async function parseKuaishouDirect(url) {
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

        console.log('Parse request for:', url);

        let result;
        
        if (url.includes('douyin.com') || url.includes('v.douyin.com')) {
            try {
                result = await parseDouyinDirect(url);
                console.log('Direct parse succeeded');
            } catch (directError) {
                console.error('Direct parse failed:', directError.message);
                result = await parseWithThirdPartyApi(url);
                console.log('Third-party API parse succeeded');
            }
        } else if (url.includes('xiaohongshu.com')) {
            try {
                result = await parseXiaohongshuDirect(url);
            } catch (directError) {
                result = await parseWithThirdPartyApi(url);
            }
        } else if (url.includes('kuaishou.com') || url.includes('v.kuaishou.com')) {
            try {
                result = await parseKuaishouDirect(url);
            } catch (directError) {
                result = await parseWithThirdPartyApi(url);
            }
        } else {
            res.status(400).json({ error: '不支持的平台' });
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Parse error:', error.message);
        res.status(500).json({ error: error.message });
    }
};