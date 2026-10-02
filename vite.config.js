import {defineConfig} from 'vite';
export default defineConfig({root:'game',envDir:'..',server:{host:'127.0.0.1',port:5173,strictPort:true},build:{outDir:'../dist',emptyOutDir:true,target:'es2020',rollupOptions:{output:{manualChunks:{vendor:['react','react-dom','pocketbase','@colyseus/sdk']}}}}});
