import sys
try:
    from moviepy import VideoFileClip
    print("SUCCESS: from moviepy import VideoFileClip")
except ImportError:
    print("FAIL: from moviepy import VideoFileClip")
    try:
        from moviepy.video.io.VideoFileClip import VideoFileClip
        print("SUCCESS: from moviepy.video.io.VideoFileClip import VideoFileClip")
    except ImportError as e:
        print(f"FAIL: All imports failed. Error: {e}")
