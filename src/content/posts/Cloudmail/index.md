---
title: CloudMail 一个基于Workers无限收发邮箱的开源项目
published: 2026-07-13
description: 只需要一个域名，就可以创建多个不同的邮箱，类似各大邮箱平台，本项目可部署到 Cloudflare Workers ，个人0服务器成本，搭建自己的邮箱服务
image: ./cover.png
tags: [Cloudflare, Workers, Email, Resend, 邮箱搭建]
category: 邮箱
draft: false
---

## 前言

只需要一个域名，就可以创建多个不同的邮箱，类似各大邮箱平台，本项目可部署到 Cloudflare Workers ，个人0服务器成本，搭建自己的邮箱服务



**此域名必须托管至Cloudflare**



(昨天还想着自己用WPF做一个实现Resend Api的项目呢...今天就看到了更好的)



## CloudMail收邮件



### 1.新建Cloud Workers

先Fork仓库 [Cloudflare Email 邮箱 Mail](https://github.com/hy4962/cloud-mail)

然后去CF新建Worker，从Github导入

点开**高级设置**，路径设置为**/mail-worker**

![从Github导入Worker](./CreateWorker.png)

### 2.设置环境变量

| 变量名     | 必需 | 用途                                                       |
| :--------- | :--: | :--------------------------------------------------------- |
| domain     |  ✅   | 邮箱域名,多域名用（例如 `["example.com","example2.com"]`） |
| admin      |  ✅   | 管理员邮箱地址（例如 `admin@example.com`）                 |
| jwt_secret |  ✅   | JWT密钥 随便输入一串字符串，不要输入特殊字符               |

（在此之前推荐先绑定自己的域名，这里不多赘述了，可以去看我的优选IP文章，推荐直接优选了再做本步骤）

![环境变量配置](./string.png)

### 3.新建D1数据库，KV存储，R2存储桶

命名个人推荐

Cloud-mail-DB

Cloud-mail-KV

Cloud-mail-R2

![创建D1数据库](./CreateD1db.png)

![创建KV存储](./CreateKV.png)

![创建R2存储桶](./CreateR2.png)

然后回到Cloud-mail的Worker项目，**全部都绑定上**

添加绑定，变量名必须为`kv`和`db`

![绑定KV和DB变量](./KVDB.png)

![绑定设置详情](./Binding.png)

### 4.域名设置转发

如果你域名没有设置过，刚进来应该会就叫你解析DNS，更详细看上篇文章

将邮件路由转到至刚刚的Worker项目

![域名邮件路由设置](./Form.png)

### 5.初始化 Cloud-Mail

浏览器输入 `https://你的worker自定义域/api/init/你的jwt_secret` 初始化数据库

看到浏览器返回**success**即可



直接访问`https://你的worker自定义域/`

**注册登录管理员账号**

管理员账号就是你前面设置的admin变量的值

到这一步，CloudMail就部署完成了

![管理员登录界面](./adminlogin.png)

## Resend发送邮件

Cloudflare 目前不支持发件，封禁25端口，只能使用第三方服务

### 1.[注册Resend](https://resend.com/login)，并添加域名，完成DNS验证

![Resend添加域名](./resendadd.png)

### 2.创建 API Key 并复制

![创建Resend API Key](./resendapi.png)

### 3.设置发送状态回调

添加一个

![添加Webhook](./resendaddweb.png)

输入`https://worker自定义域/api/webhooks`

并设置权限

![Webhook权限设置](./resendweb.png)

### 4.填入Token

![填入Resend Token](./addtoken.png)



## 结语

至此，收发邮箱均可以使用

后台也**可以设置将邮件转发到自己真实的邮箱**，更方便通知