---
title: "我的游戏性能优化方案：从系统到硬件折腾了一遍"
published: 2026-07-22
updated: 2026-07-27
description: "把 Windows 系统设置、CPU 调优、GPU 超频、鼠标延迟都折腾了一遍，记录一下目前在用的配置"
tags: [游戏优化, Windows, CPU超频, GPU超频, 鼠标延迟, 系统优化, NVIDIA]
image: ./fengmian.png
category: Windows
draft: false
---

最近 CS2 打得比较多，总觉得帧数不够稳、鼠标有点拖。从系统设置到硬件超频折腾了一遍，现在舒服多了。弄之前平均帧大概 580-600，low 只有 200-210；弄完后平均帧 657，low 250。

先说我的配置：

- CPU：9955HX
- GPU：5070Ti 12G Laptop
- 内存：16X2=32G( 镁光M8D1 )
- 系统：XOS11 25H2 V15

![CS2设置](assets/cs2config.jpg)

下面按折腾顺序来，从 BIOS 到系统设置都讲一遍。

---

## BIOS 设置

先把硬件层面的搞定。

### CPU

- **UMAF 分核负压设置**：如下图所示,[Github:hy4962/UMAF_BETA.zip ](https://github.com/hy4962/Share/blob/main/Windows/ZIP/UMAF_BETA.zip)
- **关闭 VBS + 内存虚拟化**：使用[Github:hy4962/关闭DG和VBS自动包](https://github.com/hy4962/Share/blob/main/Windows/ZIP/关闭DG和VBS自动包.zip)执行重启后疯狂按F3开机即可
- **频率**： 4.8 G

![CPU 负压设置](assets/cpu-negative-pressure.jpg)

> 尝试禁用CCD1的方案然后跑5.2 G和5.0G，但是温度反而100°C，93°C了，双CCD4.8G倒是最多85°C，都是用同一套负压。奇怪...

### 内存条

本人是**镁光 M8D1**，原生 5600c46，101ns，超到 6000c40，85ns到88ns。我的作业貌似非常保守，这个也是超别人的

![内存超频参数](assets/memory-overclocking.png)

这里我把**第一个**26**改成了28**，**第五个**4E**改成了52**

![UMAF_SPD](assets/umaf_spd.jpg)

---

## GPU 超频

硬件搞定了，再来折腾 N 卡。

安装厂商官方驱动包，但没安装核显、N 卡驱动和 AMD 安全启动。厂商控制台 CPU 全拉满，然后对 N 卡进行超频：

![N卡控制面板1](assets/gpu-settings.png)
![N卡控制面板2](assets/gpu-settings2.png)

- **核心频率**：+250 MHz
- **显存频率**：+300 MHz

![GPU 超频设置 1](assets/gpu-overclock-settings-new.png)

![GPU 超频设置 2](assets/gpu-overclock-metrics.png)

> N 卡驱动我自己用 596.36-notebook-win10-win11-64bit-international-dch-whql

---

## 系统设置

硬件调完了，软件层面也得搞一下。

### Process Lasso Pro 配置

规则添加游戏进程就完事了：禁用 CPU0 + 提升进程优先级。

![Process Lasso 设置](assets/process-lasso-cs2.png)

#### 金银核与禁用 CPU0 的原理

`perf#1` 代表系统会优先将任务分配到该核心上。我的金银核是 Core 0 和 Core 4。

简单来说：如果你的金银核中有一个正好在 CPU0 上（比如我的情况），游戏禁用 CPU0 的收益最高。因为在鼠标、键盘高轮询率的情况下，系统会优先用金银核处理输入事件。禁用 CPU0 后，游戏反而会更流畅——因为输入处理不再抢占游戏核心的资源。

![金银核示意](assets/cpu-golden-core.png)

### 快速配置

使用 Booster 快速设置最佳配置，然后手动恢复 WiFi 和蓝牙为正常打开状态。

> 提示：这个系统需要在设备管理器里单独手动安装 WiFi 驱动。

![Booster WiFi 驱动安装](assets/booster-wifi-driver.png)

---

## 鼠标延迟

最后处理鼠标问题，这一套搞完鼠标就不拖了。

### 1. 关闭鼠标加速

**默认状态**：开启

**操作步骤**：`Win + R` → 输入 `main.cpl` → 确定 → 指针选项 → 取消勾选「提高指针精确度」→ 应用

**效果**：修复鼠标拖不动

### 2. 修改 Win32PrioritySeparation 为 42（十进制）

**默认值**：十进制 2

**操作步骤**：`Win + R` → 输入 `regedit` → 确定 → 找到路径：

```
HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Control\PriorityControl
```
双击 `Win32PrioritySeparation`，修改为十进制 `42`（需重启生效）

**效果**：修复鼠标拖不动

### 3. 关闭 USB 选择性暂停

**默认状态**：已启用

**操作步骤**：`Win + R` → 输入 `powercfg.cpl` → 确定 → 更改计划设置 → 更改高级电源设置 → USB 设置 → USB 选择性暂停设置 → 改成「已禁用」

![USB 选择性暂停](assets/usbsetting.png)

**效果**：修复鼠标拖不动

> 提示：如果没有 USB 设置选项
>
> 则访问注册表`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\54533251-82be-4824-96c1-47b60b740d00`
>
> 在右侧找到 `Attributes`，双击，将数值从 `1` 改为 `2`
>
> 或者请参考下图操作：

![USB 电源设置](assets/usb-power-settings.png)

### 4. 关闭修复应用缩放（仅 Win10）

**默认状态**：开启

**操作步骤**：桌面右键 → 显示设置 → 高级缩放设置 → 修复应用缩放 → 关

**效果**：修复鼠标掉帧

> 此项仅限 Win10，Win11 不用理会。

### 5. 关闭「在打字时隐藏指针」

**默认状态**：开启

**操作步骤**：`Win + R` → 输入 `main.cpl` → 确定 → 指针选项 → 取消选中「在打字时隐藏指针」

**效果**：修复鼠标掉帧（需重启生效，虽然抽象但确实影响鼠标表现）

---

## 还有几个坑

AMD最好禁用高精度处理器，特别在老AMD上，一两天会有一次非常剧烈的卡顿，甚至在桌面也有，禁用后即可解决，但其实在新AMD上几乎看不到，反正禁用没坏处...

设备管理器-系统设备-高精度事件计时器-右键禁用

![禁用高精度事件计时器](assets/disable-hpet.png)

对于AMD纯大核心的设计，电源计划的调度必须选择全部和异类策略4，否则会出现分配不均的情况，因为默认的是英特尔大小核的调度。

但是如果你说双CCD延迟高，你用上面说到的Process Lasso Pro改需要延迟低的程序，绑定一个CCD亲和性就就行了

> （很多笔记本默认隐藏了这2个选项，要调整需要更改注册表。 点击"Windows键"+"R键"，输入regedit打开注册表编辑器，在"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\54533251-82be-4824-96c1-47b60b740d00\"下找到"93b8b6dc-0698-4d1c-9ee4-0644e900c85d"以及"bae08b81-2d5e-4688-ad6a-13243356654b"，进去后将2个路径下的"Attributes"值由默认0更改为2，重新打开电源计划即可更改异类线程调度策略和异类短运行线程调度策略。）

![电源计划设置1](assets/power-plan-settings.png)

![电源计划设置2](assets/power-plan-settings-2.png)

---

# 总结

折腾完之后 CS2 帧数稳了不少，鼠标也不拖了。说实话挺烦的，但搞完确实舒服。

核心配置：

- **CPU**：4.8G + 全核分核负压
- **GPU**：核心频率 +250Mhz，显存频率 +300Mhz
- **内存**：5600C46 → 6000C40
- **系统**：XOS11 25H2 + Booster 快速最佳设置 + 鼠标设置
- **电源**：解锁电源计划隐藏选项，使用高性能电源计划把异类策略改为4，异类调度改为全部并取消 USB 节能
- **设备管理器**：取消所有 USB 设备"允许计算机关闭此设备以节约电源"

接下来打算试试内存能不能再压一下时序，看看有没有提升。
