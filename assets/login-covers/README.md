# 登录封面素材

这个目录用于保存登录封面图片、GIF/WebP 动图和视频。

在设置页上传后，文件会自动保存到：

```text
/assets/login-covers/
```

支持格式：

- 图片：jpg、jpeg、png、gif、webp
- 视频：mp4、webm、mov

VPS Docker 部署时，这个目录会挂载到容器内，保证后台上传的封面文件不会因为重新构建镜像而丢失。
