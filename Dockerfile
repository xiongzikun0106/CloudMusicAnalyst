# 前端容器 — Nginx 静态文件
FROM nginx:alpine
COPY index.html style.css app.js battle.js review.js /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]