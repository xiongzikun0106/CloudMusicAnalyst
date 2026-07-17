FROM nginx:alpine
COPY index.html style.css app.js config.js /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]