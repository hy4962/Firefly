![image-20260718110339217](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110339217.png)

![image-20260718110414685](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110414685.png)

![image-20260718110424714](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110424714.png)

![image-20260718110524043](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110524043.png)

![image-20260718110551842](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110551842.png)

![image-20260718110743533](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110743533.png)

![image-20260718110820205](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718110820205.png)

正常来说到这里就结束了

但是，如果你的docker宿主机有代理，而且tunnel也被代理了，那么，就需要把本地地址改成局域网ip

且代理的Fake-IP-Filter需要增加

+.argotunnel.com
+.v2.argotunnel.com
api.cloudflare.com

+.cloudflare.com(可选)

![image-20260718112429799](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718112429799.png)

其实如果你是fnos，应用商店有个更方便的tunnel应用，gui操作更方便简单，但是我本人测试相对来说没docker容器那么稳，那么可控，对了，如果这个应用连不上报错的话，去设置里把这个改一下，两个都可以试试，docker默认的是quic，应用默认是http/2,

![image-20260718114458688](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20260718114458688.png)