# 在 FNOS 上装 iStoreOS 虚拟机，记录一下折腾过程

前阵子一直在折腾 NAS，用的是 FNOS。用了一段时间感觉还行，但有些网络方面的功能想折腾一下，就想着在上面跑个 iStoreOS 的虚拟机。

iStoreOS 是基于 OpenWrt 的，软路由功能该有的都有，而且有应用商店，装插件方便。我之前在别的机器上装过，这次想在 FNOS 上跑一个。

## 一、准备工作

先去 iStoreOS 官网下了个固件，x86_64 的版本。下载地址是 fw.koolcenter.com/iStoreOS/x86_64/，挑一个合适的版本就行。

![01-下载iStoreOS固件](images/01-下载iStoreOS固件.jpg)

然后在 FNOS 里先把 OVS 和 SSH 开了。

OVS 在 iStoreOS 后台的网络设置里关掉。

![02-OVS设置](images/02-OVS设置.jpg)

SSH 在 FNOS 的系统设置里开启。

![03-SSH设置](images/03-SSH设置.png)

## 二、新建虚拟机

FNOS 的虚拟机管理界面挺直观的，新建一个虚拟机，填好名称，选 Linux 系统。

![04-新建虚拟机](images/04-新建虚拟机.png)

先随便上传一个 ISO 文件到文件管理，后面要用替换镜像的方式装 iStoreOS。

![05-上传ISO文件](images/05-上传ISO文件.jpg)

配置虚拟机的 CPU、内存、挂载这个 ISO。

![06-硬件配置](images/06-硬件配置.png)

### 存储空间

存储空间我选了个 SSD，给 16G 其实就够了，富哥可以上 32G 甚至更大，看你自己。

![07-添加存储空间](images/07-添加存储空间.png)

### 网卡

网卡也选好，这个按自己网络环境来就行。

![08-添加网卡](images/08-添加网卡.png)

## 三、镜像转换

iStoreOS 官方给的是 .img 格式的镜像，但 FNOS 的虚拟机不认这个格式，它用的是 .qcow2。所以需要转换一下。

我用的工具是 StarWind V2V Converter，免费的，下载地址：
https://www.starwindsoftware.com/tmplink/starwindconverter.exe

先安装 V2V。

![09-V2V安装](images/09-V2V安装.png)

打开后选择 Local file，选自己下载的 iStoreOS .img 镜像（记得先解压）。

![10-V2V选择来源](images/10-V2V选择来源.png)
![11-V2V确认源镜像](images/11-V2V确认源镜像.png)

目标位置选本地文件。

![12-V2V选择目标位置](images/12-V2V选择目标位置.png)

目标格式选 QCOW2。

![13-V2V选择目标格式](images/13-V2V选择目标格式.png)

版本选 Qcow2 version 3。

![14-V2V选择版本](images/14-V2V选择版本.png)

设置输出文件名，然后点 Convert。

![15-V2V开始转换](images/15-V2V开始转换.png)

转换完成。

![16-V2V转换完成](images/16-V2V转换完成.png)

我这边出来的文件名是 `istoreos-24.10.7-2026070313-x86-64-squashfs-combined.qcow2`。

## 四、替换镜像

这个步骤有点绕，我第一次搞的时候卡了一会儿。

FNOS 新建虚拟机会自动生成一个 .qcow2 文件，但我们要把这个文件替换成自己转换好的那个。

先到虚拟机详情里找到实际存储路径。

![17-虚拟机存储路径](images/17-虚拟机存储路径.jpg)

用 SSH 连上 FNOS，找到这个路径下的文件。

![18-SSH文件管理](images/18-SSH文件管理.jpg)

操作步骤：
1. 复制 FNOS 自动生成的那个 .qcow2 的文件名（一串 UUID 那种，比如 `b4cf05dd-...-q6m2.qcow2`）
2. 删掉 FNOS 自动生成的文件
3. 把自己上传的镜像重命名为刚才复制的文件名

其实就是**偷梁换柱**——让 FNOS 以为自己生成的文件还在，实际上已经被换成了 iStoreOS 的镜像。

## 五、开机

替换完之后，回到虚拟机配置页面，把之前挂载的那个 ISO 镜像删掉（点叉号）。

![19-移除ISO镜像](images/19-移除ISO镜像.jpg)
![20-确认移除](images/20-确认移除.png)

然后直接开机。

看到 `iStoreOS is ready! Please press Enter to activate this console.` 这行提示，回车即可。

![21-启动成功](images/21-启动成功.jpg)

## 折腾完的感受

说实话，在 FNOS 上装 iStoreOS 不算复杂，就是镜像转换和替换这个环节稍微绕一点。核心思路就是用 V2V 把 .img 转成 .qcow2，然后替换掉 FNOS 自动生成的那个文件。

装好之后能开机了，配置和具体玩法我后面再写一篇文章细说。反正先跑起来再说，后面慢慢折腾。

## 极简流程

1. 下载 iStoreOS 固件，FNOS 开启 OVS 和 SSH
2. 新建虚拟机，配好存储和网卡
3. 用 StarWind V2V 把 iStoreOS 的 .img 转成 .qcow2
4. SSH 连 FNOS，找到虚拟机存储路径，把转换好的 .qcow2 上传
5. 复制 FNOS 自动生成的 .qcow2 文件名，删掉它，把上传的镜像改名替换
6. 回到虚拟机，开机，回车

---

*写于 2026 年 7 月，在 FNOS 上折腾 iStoreOS 的记录*