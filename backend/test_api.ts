import axios from 'axios';

async function testExport() {
  const API_URL = 'http://localhost:5001/api/export';

  const sampleTimeline = {
     "subtitles": [],
      "media": {
        "images": [],
        "videos": [
          {
            "url": "https://media.klipflow.com/file/klipflow/generated_shorts/shorts-1776283269761/1776283467748-short-3-1776283454601.mp4",
            "type": "video",
            "duration": 138,
            "startTime": 0,
            "endTime": 138,
            "isAnimated": true,
            "hasAudio": true,
            "cuts": [
              {
                "id": "clip-1774684935766-m4344em1i",
                "start": 0,
                "end": 69,
                "timelineStart": 0,
                "position": {
                  "x": 50,
                  "y": 50
                },
                "size": {
                  "width": 100,
                  "height": 31
                },
                "volume": 1,
                "zIndex": 1,
                "brightness": null,
                "contrast": null,
                "saturation": null,
                "hue": null,
                "blur": null,
                "sharpen": null,
                "flipH": null,
                "flipV": null,
                "rotate": null,
                "grayscale": null,
                "sepia": null,
                "invert": null,
                "greenScreenEnabled": null,
                "greenScreenColor": null,
                "greenScreenSimilarity": null,
                "greenScreenBlend": null,
                "fadeInDuration": null,
                "fadeOutDuration": null,
                "roundedCorners": null,
                "keyframes": []
              },
              {
                "id": "clip-1774684935766-ucmklfmvr",
                "start": 0,
                "end": 69,
                "timelineStart": 0,
                "position": {
                  "x": 50,
                  "y": 50
                },
                "size": {
                  "width": 100,
                  "height": 100
                },
                "volume": 1,
                "zIndex": 2,
                "brightness": 100,
                "contrast": 100,
                "saturation": 100,
                "hue": 0,
                "blur": 20,
                "sharpen": 0,
                "flipH": false,
                "flipV": false,
                "rotate": 0,
                "grayscale": 0,
                "sepia": 0,
                "invert": 0,
                "greenScreenEnabled": false,
                "greenScreenColor": "#00ff00",
                "greenScreenSimilarity": 0.3,
                "greenScreenBlend": 0.1,
                "fadeInDuration": null,
                "fadeOutDuration": null,
                "roundedCorners": 0,
                "keyframes": []
              }
            ]
          }
        ],
        "audio": [],
        "gif": [],
        "text": []
      },
      "transitions": [],
      "output": {
        "resolution": "1080p",
        "format": "mp4",
        "quality": "high",
        "aspectRatio": "9/16"
      }
  };

  console.log('🚀 Sending export request to:', API_URL);

  try {
    const response = await axios.post(API_URL, sampleTimeline, {
      timeout: 300000 // 5 minutes timeout for render
    });

    console.log('✅ Export successful!');
    console.log('📄 Response:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    if (error.response) {
      console.error('❌ Export failed with status:', error.response.status);
      console.error('📄 Details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('❌ Export failed:', error.message);
    }
  }
}

testExport();
