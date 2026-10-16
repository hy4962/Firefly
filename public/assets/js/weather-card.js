/**
 * 「天气预报」卡片（桌面右栏 / 移动端底部栏）—— **全站显示**。
 *
 * 数据源（参考站 blog.amamo.top 同款，免费、无需 key）：
 *   GET https://uapis.cn/api/v1/misc/weather?extended=true&forecast=true
 *   - 不传参 → 按**访客 IP** 定位，每个访客看到自己所在地的天气；
 *   - 也支持 ?city=广州 / ?adcode=440105 固定到指定城市（改下面的 FIXED_CITY）。
 *   - CORS 已放开（Origin 回显），前端直连无需代理。
 *   ⚠️ 该接口有配额（响应头里能看到：visitor-quota 1500 credits / 31 天，
 *      ip-daily 2000 / 天），所以下面 CACHE_TTL 给到 30 分钟，
 *      同一个访客半小时内怎么翻页都只请求一次。
 *
 * 注入路径（不改任何上游文件）：
 *   1. 样式在 src/config/FooterConfig.html 的 <style id="ff-weather-style">，
 *      卡片 DOM 由本脚本自己拼（不像「最近评论」那样在页脚放壳子 —— 这张卡片
 *      有 50+ 个节点、几乎每个都要按接口字段回填，放正文里反而更难维护）；
 *   2. 本脚本由页脚的 PAGE_SCRIPTS 全站加载（path: /.* /）；
 *   3. 挂载点按视口切换：≥768px 进右栏 top 组件容器（#right-sidebar 第一个子 div）
 *      的末尾，<768px 进移动端底部组件栏 #bottom-sidebar。两个容器都在 swup
 *      替换范围之外，搬一次即永久有效，切页不会丢。
 *
 * 关于折叠：上游 WidgetLayout.astro 那套 <widget-layout> 折叠靠自定义元素的
 * constructor 取子节点，动态插入时构造时机不可控，所以这里自己实现（就一个 class
 * 切换）。默认**展开**，与站长截的参考站展开态一致；点击后收起并记在 sessionStorage，
 * 同一次会话里切页保持收起状态。
 */
(function () {
	"use strict";

	// ===================== 配置 =====================

	// 天气接口。换源只改这一行（字段名要跟着改 render()）
	var API_URL =
		"https://uapis.cn/api/v1/misc/weather?extended=true&forecast=true";

	// 固定城市：留空 = 按访客 IP 定位；想固定成站长常驻地就填 "广州" 或 adcode "440105"
	var FIXED_CITY = "";

	// 缓存 30 分钟。接口按 IP 定位，同一访客半小时内翻多少页都只请求一次
	var CACHE_KEY = "ff:weather:data:v1";
	var CACHE_TTL = 30 * 60 * 1000;

	// 折叠状态（会话级，关掉标签页就回到默认展开）
	var VIEW_KEY = "ff:weather:collapsed:v1";
	var DEFAULT_COLLAPSED = false;

	// 移动端断点与主题布局保持一致（layout-base.css：≤767px 隐藏左右侧栏、启用底部栏）
	var MOBILE_QUERY = "(max-width: 767px)";

	// 英文站不挂（卡片文案是中文）
	var SKIP_PATH = /^\/en(\/|$)/;

	// 收起时露出的高度：标题 + 地点 + 大号温度 + 高低温，正好到温区那儿
	var COLLAPSED_HEIGHT = "12rem";

	// ===================== 图标（material-symbols，内联 path）=====================
	// 数据来自 iconify 的 material-symbols 集合，直接内联成字符串 —— 不依赖页面上的
	// astro-icon symbol 表（那些 symbol 是构建期按需渲染的，我这边动态插入的节点
	// 取不到，硬写 <use href="#ai:..."> 会渲染成空白）。
	var ICONS = {
		"ac-unit": "<path fill=\"currentColor\" d=\"M11 22v-4.15l-3.25 3.2l-1.4-1.4L11 15v-2H9l-4.65 4.65l-1.4-1.4L6.15 13H2v-2h4.15l-3.2-3.25l1.4-1.4L9 11h2V9L6.35 4.35l1.4-1.4L11 6.15V2h2v4.15l3.25-3.2l1.4 1.4L13 9v2h2l4.65-4.65l1.4 1.4l-3.2 3.25H22v2h-4.15l3.2 3.25l-1.4 1.4L15 13h-2v2l4.65 4.65l-1.4 1.4l-3.25-3.2V22z\"/>",
		"air": "<path fill=\"currentColor\" d=\"M11.5 20q-1.25 0-2.125-.875T8.5 17h2q0 .425.288.713T11.5 18t.713-.288T12.5 17t-.288-.712T11.5 16H2v-2h9.5q1.25 0 2.125.875T14.5 17t-.875 2.125T11.5 20M2 10V8h13.5q.65 0 1.075-.425T17 6.5t-.425-1.075T15.5 5t-1.075.425T14 6.5h-2q0-1.475 1.013-2.488T15.5 3t2.488 1.013T19 6.5t-1.012 2.488T15.5 10zm16.5 8v-2q.65 0 1.075-.425T20 14.5t-.425-1.075T18.5 13H2v-2h16.5q1.475 0 2.488 1.013T22 14.5t-1.012 2.488T18.5 18\"/>",
		"bedtime": "<path fill=\"currentColor\" d=\"M12.1 22q-2.1 0-3.937-.8t-3.2-2.162t-2.163-3.2T2 11.9q0-3.65 2.325-6.437T10.25 2q-.45 2.475.275 4.838t2.5 4.137t4.138 2.5T22 13.75q-.65 3.6-3.45 5.925T12.1 22\"/>",
		"clear-night": "<path fill=\"currentColor\" d=\"M12.1 22q-2.1 0-3.937-.8t-3.2-2.162t-2.163-3.2T2 11.9q0-3.65 2.325-6.437T10.25 2q-.45 2.475.275 4.838t2.5 4.137t4.138 2.5T22 13.75q-.65 3.6-3.45 5.925T12.1 22\"/>",
		"cloud": "<path fill=\"currentColor\" d=\"M6.5 20q-2.275 0-3.887-1.575T1 14.575q0-1.95 1.175-3.475T5.25 9.15q.625-2.3 2.5-3.725T12 4q2.925 0 4.963 2.038T19 11q1.725.2 2.863 1.488T23 15.5q0 1.875-1.312 3.188T18.5 20z\"/>",
		"cloudy": "<path fill=\"currentColor\" d=\"M6.5 20q-2.275 0-3.887-1.575T1 14.575q0-1.95 1.175-3.475T5.25 9.15q.625-2.3 2.5-3.725T12 4q2.925 0 4.963 2.038T19 11q1.725.2 2.863 1.488T23 15.5q0 1.875-1.312 3.188T18.5 20z\"/>",
		"compress": "<path fill=\"currentColor\" d=\"M4 14v-2h16v2zm0-3V9h16v2zm7 11v-3.2l-1.6 1.6L8 19l4-4l4 4l-1.4 1.4l-1.6-1.55V22zm1-14L8 4l1.4-1.4L11 4.2V1h2v3.2l1.6-1.6L16 4z\"/>",
		"eco": "<path fill=\"currentColor\" d=\"M11.25 22q-.825 0-1.662-.187t-1.713-.538q.3-3.025 1.75-5.65T13.35 11q-2.75 1.4-4.762 3.7t-2.813 5.25q-.1-.075-.187-.162L5.4 19.6q-1.175-1.175-1.787-2.625T3 13.95q0-1.7.675-3.25T5.55 7.95q2.025-2.025 5.25-2.637t9.05-.113q.45 5.975-.15 9.113t-2.6 5.137q-1.225 1.225-2.738 1.888T11.25 22\"/>",
		"error-outline": "<path fill=\"currentColor\" d=\"M12.713 16.713Q13 16.425 13 16t-.288-.712T12 15t-.712.288T11 16t.288.713T12 17t.713-.288M11 13h2V7h-2zm1 9q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8\"/>",
		"foggy": "<path fill=\"currentColor\" d=\"M18 19q-.425 0-.712-.288T17 18t.288-.712T18 17t.713.288T19 18t-.288.713T18 19M7 22q-.425 0-.712-.288T6 21t.288-.712T7 20t.713.288T8 21t-.288.713T7 22m-1-3q-.425 0-.712-.288T5 18t.288-.712T6 17h9q.425 0 .713.288T16 18t-.288.713T15 19zm4 3q-.425 0-.712-.288T9 21t.288-.712T10 20h7q.425 0 .713.288T18 21t-.288.713T17 22zm-2.5-6q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.238T12 2q2.25 0 3.913 1.438t2.012 3.587q1.725.15 2.9 1.425T22 11.5q0 1.875-1.312 3.188T17.5 16z\"/>",
		"haze": "<path fill=\"currentColor\" d=\"M18 19q-.425 0-.712-.288T17 18t.288-.712T18 17t.713.288T19 18t-.288.713T18 19M7 22q-.425 0-.712-.288T6 21t.288-.712T7 20t.713.288T8 21t-.288.713T7 22m-1-3q-.425 0-.712-.288T5 18t.288-.712T6 17h9q.425 0 .713.288T16 18t-.288.713T15 19zm4 3q-.425 0-.712-.288T9 21t.288-.712T10 20h7q.425 0 .713.288T18 21t-.288.713T17 22zm-2.5-6q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.238T12 2q2.25 0 3.913 1.438t2.012 3.587q1.725.15 2.9 1.425T22 11.5q0 1.875-1.312 3.188T17.5 16z\"/>",
		"humidity-high": "<path fill=\"currentColor\" d=\"M12 21.5q-3.325 0-5.663-2.3T4 13.6q0-1.575.613-3.012T6.35 8.05l4.25-4.175q.3-.275.663-.425T12 3.3t.738.15t.662.425l4.25 4.175q1.125 1.1 1.738 2.538T20 13.6q0 3.3-2.337 5.6T12 21.5\"/>",
		"keyboard-arrow-up-rounded": "<path fill=\"currentColor\" d=\"m12 10.8l-3.9 3.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.6-4.6q.3-.3.7-.3t.7.3l4.6 4.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275z\"/>",
		"light-mode": "<path fill=\"currentColor\" d=\"M8.463 15.538Q7 14.075 7 12t1.463-3.537T12 7t3.538 1.463T17 12t-1.463 3.538T12 17t-3.537-1.463M5 13H1v-2h4zm18 0h-4v-2h4zM11 5V1h2v4zm0 18v-4h2v4zM6.4 7.75L3.875 5.325L5.3 3.85l2.4 2.5zm12.3 12.4l-2.425-2.525L17.6 16.25l2.525 2.425zM16.25 6.4l2.425-2.525L20.15 5.3l-2.5 2.4zM3.85 18.7l2.525-2.425L7.75 17.6l-2.425 2.525z\"/>",
		"location-on": "<path fill=\"currentColor\" d=\"M13.413 11.413Q14 10.825 14 10t-.587-1.412T12 8t-1.412.588T10 10t.588 1.413T12 12t1.413-.587M12 22q-4.025-3.425-6.012-6.362T4 10.2q0-3.75 2.413-5.975T12 2t5.588 2.225T20 10.2q0 2.5-1.987 5.438T12 22\"/>",
		"more-horiz": "<path fill=\"currentColor\" d=\"M6 14q-.825 0-1.412-.587T4 12t.588-1.412T6 10t1.413.588T8 12t-.587 1.413T6 14m6 0q-.825 0-1.412-.587T10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14m6 0q-.825 0-1.412-.587T16 12t.588-1.412T18 10t1.413.588T20 12t-.587 1.413T18 14\"/>",
		"partly-cloudy-day": "<path fill=\"currentColor\" d=\"M6 20q-1.65 0-2.825-1.175T2 16t1.175-2.825T6 12q1.2 0 2.213.65t1.462 1.775l.25.575h.6q1.05 0 1.763.725T13 17.5t-.725 1.775T10.5 20zm8.975-2.8q-.1-1.575-1.137-2.725t-2.613-1.425q-.775-1.35-2.087-2.137T6.25 10q.65-1.825 2.225-2.912T12 6q2.5 0 4.25 1.75T18 12q0 1.625-.8 3.013T14.975 17.2M11 5V1h2v4zm6.65 2.75l-1.4-1.4l2.8-2.85l1.425 1.425zM19 13v-2h4v2zm.05 7.5l-2.8-2.85l1.4-1.4l2.85 2.8zM6.35 7.75L3.525 4.925L4.95 3.5l2.8 2.85z\"/>",
		"partly-cloudy-night": "<path fill=\"currentColor\" d=\"M6 13q1.2 0 2.2.65t1.475 1.775l.25.575h.625q1.05 0 1.75.738T13 18.5q0 1.05-.725 1.775T10.5 21H6q-1.65 0-2.825-1.175T2 17q0-1.675 1.175-2.838T6 13m5.25-11q-.45 2.475.275 4.838t2.5 4.137t4.138 2.5T23 13.75q-.65 3.55-3.375 5.863T13.325 22q.8-.65 1.238-1.562T15 18.5q0-1.7-1.062-2.937t-2.713-1.488q-.8-1.425-2.187-2.25T6 11q-.8 0-1.562.2T3 11.8q.05-3.625 2.363-6.375T11.25 2\"/>",
		"rainy": "<path fill=\"currentColor\" d=\"M13.95 21.9q-.375.2-.762.063t-.588-.513l-1.5-3q-.2-.375-.062-.762t.512-.588t.763-.062t.587.512l1.5 3q.2.375.063.763t-.513.587m6 0q-.375.2-.762.063t-.588-.513l-1.5-3q-.2-.375-.062-.762t.512-.588t.763-.062t.587.512l1.5 3q.2.375.063.763t-.513.587m-12 0q-.375.2-.762.063T6.6 21.45l-1.5-3q-.2-.375-.062-.762t.512-.588t.763-.062t.587.512l1.5 3q.2.375.063.763t-.513.587M7.5 16q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.238T12 2q2.25 0 3.913 1.438t2.012 3.587q1.725.15 2.9 1.425T22 11.5q0 1.875-1.312 3.188T17.5 16z\"/>",
		"rainy-heavy": "<path fill=\"currentColor\" d=\"M8.45 18.9q-.375.2-.762.063T7.1 18.45l-6-12q-.2-.375-.062-.763T1.55 5.1t.763-.062t.587.512l6 12q.2.375.063.763t-.513.587m4.675 0q-.375.2-.763.063t-.587-.513l-6-12q-.2-.375-.062-.763t.512-.587t.75-.062t.575.512l6.025 12q.2.375.063.763t-.513.587m4.675-.025q-.375.2-.763.075t-.587-.5l-6-12q-.2-.375-.062-.763T10.9 5.1t.75-.062t.575.512l6.025 12q.2.375.063.75t-.513.575m3.888.088q-.388-.138-.588-.513l-6-12q-.2-.375-.062-.763t.512-.587t.763-.062t.587.512l6 12q.2.375.063.763t-.513.587t-.762.063\"/>",
		"refresh": "<path fill=\"currentColor\" d=\"M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V4h2v7h-7V9h4.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.925 0 3.475-1.1T17.65 14h2.1q-.7 2.65-2.85 4.325T12 20\"/>",
		"schedule": "<path fill=\"currentColor\" d=\"m15.3 16.7l1.4-1.4l-3.7-3.7V7h-2v5.4zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22\"/>",
		"science": "<path fill=\"currentColor\" d=\"M5 21q-1.275 0-1.812-1.137t.262-2.113L9 11V5H8q-.425 0-.712-.288T7 4t.288-.712T8 3h8q.425 0 .713.288T17 4t-.288.713T16 5h-1v6l5.55 6.75q.8.975.263 2.113T19 21z\"/>",
		"snowing": "<path fill=\"currentColor\" d=\"M6 15.25q-.5 0-.875-.375T4.75 14q0-.525.375-.888T6 12.75q.525 0 .888.363T7.25 14q0 .5-.363.875T6 15.25m0-8q-.5 0-.875-.375T4.75 6q0-.525.375-.888T6 4.75q.525 0 .888.363T7.25 6q0 .5-.363.875T6 7.25m3 12q-.5 0-.875-.375T7.75 18q0-.525.375-.888T9 16.75q.525 0 .888.363t.362.887q0 .5-.363.875T9 19.25m0-8q-.5 0-.875-.375T7.75 10q0-.525.375-.888T9 8.75q.525 0 .888.363t.362.887q0 .5-.363.875T9 11.25m3 4q-.5 0-.875-.375T10.75 14q0-.525.375-.888T12 12.75q.525 0 .888.363t.362.887q0 .5-.363.875T12 15.25m0-8q-.5 0-.875-.375T10.75 6q0-.525.375-.888T12 4.75q.525 0 .888.363T13.25 6q0 .5-.363.875T12 7.25m3 12q-.5 0-.875-.375T13.75 18q0-.525.375-.888T15 16.75q.525 0 .888.363t.362.887q0 .5-.363.875T15 19.25m0-8q-.5 0-.875-.375T13.75 10q0-.525.375-.888T15 8.75q.525 0 .888.363t.362.887q0 .5-.363.875T15 11.25m3 4q-.5 0-.875-.375T16.75 14q0-.525.375-.888T18 12.75q.525 0 .888.363t.362.887q0 .5-.363.875T18 15.25m0-8q-.5 0-.875-.375T16.75 6q0-.525.375-.888T18 4.75q.525 0 .888.363T19.25 6q0 .5-.363.875T18 7.25\"/>",
		"snowy": "<path fill=\"currentColor\" d=\"M6 15.25q-.5 0-.875-.375T4.75 14q0-.525.375-.888T6 12.75q.525 0 .888.363T7.25 14q0 .5-.363.875T6 15.25m0-8q-.5 0-.875-.375T4.75 6q0-.525.375-.888T6 4.75q.525 0 .888.363T7.25 6q0 .5-.363.875T6 7.25m3 12q-.5 0-.875-.375T7.75 18q0-.525.375-.888T9 16.75q.525 0 .888.363t.362.887q0 .5-.363.875T9 19.25m0-8q-.5 0-.875-.375T7.75 10q0-.525.375-.888T9 8.75q.525 0 .888.363t.362.887q0 .5-.363.875T9 11.25m3 4q-.5 0-.875-.375T10.75 14q0-.525.375-.888T12 12.75q.525 0 .888.363t.362.887q0 .5-.363.875T12 15.25m0-8q-.5 0-.875-.375T10.75 6q0-.525.375-.888T12 4.75q.525 0 .888.363T13.25 6q0 .5-.363.875T12 7.25m3 12q-.5 0-.875-.375T13.75 18q0-.525.375-.888T15 16.75q.525 0 .888.363t.362.887q0 .5-.363.875T15 19.25m0-8q-.5 0-.875-.375T13.75 10q0-.525.375-.888T15 8.75q.525 0 .888.363t.362.887q0 .5-.363.875T15 11.25m3 4q-.5 0-.875-.375T16.75 14q0-.525.375-.888T18 12.75q.525 0 .888.363t.362.887q0 .5-.363.875T18 15.25m0-8q-.5 0-.875-.375T16.75 6q0-.525.375-.888T18 4.75q.525 0 .888.363T19.25 6q0 .5-.363.875T18 7.25\"/>",
		"storm": "<path fill=\"currentColor\" d=\"M18.15 22q.625-1.55.875-3.175t.125-3.275q-.975 2.075-2.912 3.262T12 20q-2.1 0-3.8-.987t-2.9-2.638t-1.85-3.787T2.8 8.15q0-1.575.213-3.113T3.75 2h2.1q-.6 1.55-.862 3.175T4.85 8.45q.975-2.075 2.913-3.262T12 4q2.1 0 3.8.988t2.9 2.637t1.85 3.788t.65 4.437q0 1.575-.212 3.113T20.25 22zm-3.325-7.175Q16 13.65 16 12t-1.175-2.825T12 8T9.175 9.175T8 12t1.175 2.825T12 16t2.825-1.175m-4.237-1.412Q10 12.825 10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14t-1.412-.587\"/>",
		"sunny": "<path fill=\"currentColor\" d=\"M11 5V1h2v4zm6.65 2.75l-1.375-1.375l2.8-2.875l1.4 1.425zM19 13v-2h4v2zm-8 10v-4h2v4zM6.35 7.7L3.5 4.925l1.425-1.4L7.75 6.35zm12.7 12.8l-2.775-2.875l1.35-1.35l2.85 2.75zM1 13v-2h4v2zm3.925 7.5l-1.4-1.425l2.8-2.8l.725.675l.725.7zm2.825-4.25Q6 14.5 6 12t1.75-4.25T12 6t4.25 1.75T18 12t-1.75 4.25T12 18t-4.25-1.75\"/>",
		"thermostat": "<path fill=\"currentColor\" d=\"M13 11V9h5v2zm0-4V5h8v2zM4.463 19.538Q3 18.075 3 16q0-1.2.525-2.238T5 12V6q0-1.25.875-2.125T8 3t2.125.875T11 6v6q.95.725 1.475 1.763T13 16q0 2.075-1.463 3.538T8 21t-3.537-1.463M5 16h6q0-.725-.312-1.35T9.8 13.6L9 13V6q0-.425-.288-.712T8 5t-.712.288T7 6v7l-.8.6q-.575.425-.888 1.05T5 16\"/>",
		"thunderstorm": "<path fill=\"currentColor\" d=\"m7.5 23l.9-2.5H6.5L7.75 17h2.5l-1.075 2.5h2.075L8.5 23zm6.75-1l.7-2H13l1.075-3h2.5l-.875 2h2.05l-2.5 3zM7.5 16q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.238T12 2q2.25 0 3.913 1.438t2.012 3.587q1.725.15 2.9 1.425T22 11.5q0 1.875-1.312 3.188T17.5 16z\"/>",
		"tornado": "<path fill=\"currentColor\" d=\"M1 3h22l-2.9 5H3.9zm4.05 7h13.9l-1.75 3H6.8zm2.9 5h8.1L12 22z\"/>",
		"umbrella": "<path fill=\"currentColor\" d=\"M11.438 21.838q-.263-.163-.388-.513L6 6.075l3.5.85l1.5-1.15V3.4q0-1 .725-1.7T13.5 1t1.775.7T16 3.4V4h-2v-.6q0-.2-.15-.338t-.35-.137t-.35.137T13 3.4v2.375l1.5 1.15l3.5-.85L12.95 21.3q-.125.35-.387.525T12 22t-.562-.162M13 14.8l1.95-5.95l-.9.225L13 8.3zm-2 0V8.3l-1.05.8l-.925-.25z\"/>",
		"visibility": "<path fill=\"currentColor\" d=\"M15.188 14.688Q16.5 13.375 16.5 11.5t-1.312-3.187T12 7T8.813 8.313T7.5 11.5t1.313 3.188T12 16t3.188-1.312m-5.1-1.276Q9.3 12.625 9.3 11.5t.788-1.912T12 8.8t1.913.788t.787 1.912t-.787 1.913T12 14.2t-1.912-.787m-4.738 3.55Q2.35 14.925 1 11.5q1.35-3.425 4.35-5.462T12 4t6.65 2.038T23 11.5q-1.35 3.425-4.35 5.463T12 19t-6.65-2.037\"/>",
		"water-drop": "<path fill=\"currentColor\" d=\"M12.275 19q.3-.025.513-.238T13 18.25q0-.35-.225-.562T12.2 17.5q-1.025.075-2.175-.562t-1.45-2.313q-.05-.275-.262-.45T7.825 14q-.35 0-.575.263t-.15.612q.425 2.275 2 3.25t3.175.875m-5.987.65Q4 17.3 4 13.8q0-2.5 1.988-5.437T12 2q4.025 3.425 6.013 6.363T20 13.8q0 3.5-2.287 5.85T12 22t-5.712-2.35\"/>",
		"wb-sunny": "<path fill=\"currentColor\" d=\"M11 4V1h2v3zm0 19v-3h2v3zm9-10v-2h3v2zM1 13v-2h3v2zm17.7-6.3l-1.4-1.4l1.75-1.8l1.45 1.45zM4.95 20.5L3.5 19.05l1.8-1.75l1.4 1.4zm14.1 0l-1.75-1.8l1.4-1.4l1.8 1.75zM5.3 6.7L3.5 4.95L4.95 3.5L6.7 5.3zm2.45 9.55Q6 14.5 6 12t1.75-4.25T12 6t4.25 1.75T18 12t-1.75 4.25T12 18t-4.25-1.75\"/>",
	};

	function ico(name, cls) {
		var body = ICONS[name] || ICONS["partly-cloudy-day"] || "";
		return (
			'<svg class="ff-w-ico ' +
			(cls || "") +
			'" viewBox="0 0 24 24" aria-hidden="true">' +
			body +
			"</svg>"
		);
	}

	// 天气代码 → 图标。uapis 用的是一套三位数代码（100 晴 / 101 多云 / 104 阴 /
	// 3xx 雨 / 4xx 雪 / 5xx 雾霾），先查精确码，落空再按百位区间兜底，
	// 这样以后接口新增代码也不会显示成空白图标。
	var WEATHER_ICON = {
		100: "wb-sunny",
		101: "cloudy",
		102: "partly-cloudy-day",
		103: "partly-cloudy-day",
		104: "cloudy",
		150: "clear-night",
		151: "clear-night",
		152: "partly-cloudy-night",
		153: "partly-cloudy-night",
		200: "air",
		201: "water-drop",
		202: "thunderstorm",
		203: "rainy",
		204: "ac-unit",
		205: "rainy",
		206: "thunderstorm",
		207: "snowing",
		208: "rainy",
		209: "rainy",
		210: "thunderstorm",
		211: "storm",
		212: "tornado",
		213: "tornado",
		300: "rainy",
		301: "rainy-heavy",
		302: "thunderstorm",
		303: "thunderstorm",
		304: "storm",
		305: "rainy",
		306: "rainy",
		307: "rainy-heavy",
		308: "storm",
		309: "rainy",
		310: "rainy-heavy",
		311: "rainy-heavy",
		312: "storm",
		313: "rainy",
		314: "rainy",
		315: "rainy",
		316: "rainy-heavy",
		317: "rainy-heavy",
		318: "storm",
		350: "rainy",
		351: "rainy",
		399: "rainy",
		400: "snowing",
		401: "snowing",
		402: "snowing",
		403: "snowing",
		404: "snowy",
		405: "snowy",
		406: "snowy",
		407: "snowing",
		408: "snowing",
		409: "snowing",
		410: "snowy",
		456: "snowing",
		457: "snowing",
		499: "snowing",
		500: "foggy",
		501: "foggy",
		502: "haze",
		503: "haze",
		504: "haze",
		507: "haze",
		508: "haze",
		509: "foggy",
		510: "foggy",
		511: "haze",
		512: "haze",
		513: "haze",
		514: "foggy",
		515: "foggy",
		900: "light-mode",
		901: "ac-unit",
		999: "partly-cloudy-day",
	};

	function iconForCode(code) {
		var key = String(code || "");
		if (WEATHER_ICON[key]) return WEATHER_ICON[key];
		var head = key.charAt(0);
		if (head === "1") return "wb-sunny";
		if (head === "2") return "air";
		if (head === "3") return "rainy";
		if (head === "4") return "snowing";
		if (head === "5") return "foggy";
		return "partly-cloudy-day";
	}

	// ===================== 小工具 =====================

	function text(root, selector, value) {
		var node = root.querySelector(selector);
		if (node) node.textContent = value == null || value === "" ? "--" : value;
	}

	function safeGet(storage, key) {
		try {
			return storage.getItem(key);
		} catch (error) {
			return null;
		}
	}

	function safeSet(storage, key, value) {
		try {
			storage.setItem(key, value);
		} catch (error) {
			// 无痕模式等场景下写不进去，不影响本次渲染
		}
	}

	// ===================== 卡片骨架 =====================

	// 一行「图标 + 标签 + 值」。污染物那行是全宽的，单独拼。
	function item(icon, flavor, label, valueSelector, placeholder) {
		return (
			'<div class="ff-w-item">' +
			ico(icon, flavor) +
			'<div class="ff-w-meta">' +
			'<span class="ff-w-label">' +
			label +
			"</span>" +
			'<span class="ff-w-value" ' +
			valueSelector +
			">" +
			placeholder +
			"</span>" +
			"</div>" +
			"</div>"
		);
	}

	function pollutant(name, selector) {
		return (
			'<span class="ff-w-pollutant">' +
			name +
			': <b data-' +
			selector +
			">--</b></span>"
		);
	}

	function buildCard() {
		var html =
			'<div id="ff-weather" class="ff-w card-base" hidden>' +
			'<div class="ff-w-title"><span class="ff-w-name">天气预报</span></div>' +
			'<div class="ff-w-body">' +
			// 加载态
			'<div class="ff-w-state" data-state="loading">' +
			'<span class="ff-w-spinner" aria-hidden="true"></span>' +
			'<span class="ff-w-state-text">加载中…</span>' +
			"</div>" +
			// 错误态（带重试）
			'<div class="ff-w-state" data-state="error" hidden>' +
			ico("error-outline", "ff-w-error-ico") +
			'<span class="ff-w-state-text" data-error-text>天气加载失败</span>' +
			'<button type="button" class="ff-w-retry" data-retry>' +
			ico("refresh", "ff-w-retry-ico") +
			"<span>重试</span>" +
			"</button>" +
			"</div>" +
			// 正式内容
			'<div class="ff-w-content" data-content hidden>' +
			'<div class="ff-w-head">' +
			'<div class="ff-w-loc">' +
			ico("location-on", "ff-w-loc-ico") +
			'<span class="ff-w-city" data-city>--</span>' +
			'<span class="ff-w-district" data-district></span>' +
			"</div>" +
			'<div class="ff-w-sky" data-sky>' +
			ico("partly-cloudy-day", "ff-w-sky-ico") +
			"</div>" +
			"</div>" +
			'<div class="ff-w-temp-row">' +
			'<span class="ff-w-temp" data-temp>--</span>' +
			'<span class="ff-w-deg">°</span>' +
			'<span class="ff-w-desc" data-desc></span>' +
			"</div>" +
			'<div class="ff-w-range">' +
			'<span class="ff-w-max">高温 <b data-tmax>--</b>°C</span>' +
			'<span class="ff-w-sep">/</span>' +
			'<span class="ff-w-min">低温 <b data-tmin>--</b>°C</span>' +
			"</div>" +
			'<div class="ff-w-grid">' +
			item("air", "is-wind", "风力", "data-wind", "--") +
			item("visibility", "is-visibility", "能见度", "data-visibility", "--km") +
			item("thermostat", "is-feels", "体感温度", "data-feels-like", "--°C") +
			item("humidity-high", "is-humidity", "湿度", "data-humidity", "--%") +
			item("compress", "is-pressure", "气压", "data-pressure", "--hPa") +
			'<div class="ff-w-item">' +
			ico("eco", "is-aqi") +
			'<div class="ff-w-meta">' +
			'<span class="ff-w-label">空气质量</span>' +
			// AQI 值和等级标签是分开的节点：等级标签要按 aqi_level 换配色（见 setAqi）
			'<span class="ff-w-value"><span data-aqi>--</span><span class="ff-w-aqi-tag" data-aqi-category></span></span>' +
			"</div>" +
			"</div>" +
			item("cloud", "is-cloud", "云量", "data-cloud", "--%") +
			item("sunny", "is-uv", "紫外线", "data-uv", "--") +
			item("rainy", "is-precipitation", "降水量", "data-precipitation", "--mm") +
			item("water-drop", "is-pop", "降水概率", "data-pop", "--%") +
			item("wb-sunny", "is-sunrise", "日出", "data-sunrise", "--:--") +
			item("sunny", "is-sunset", "日落", "data-sunset", "--:--") +
			'<div class="ff-w-item ff-w-item-full">' +
			ico("science", "is-pollutant") +
			'<div class="ff-w-meta ff-w-meta-wide">' +
			'<span class="ff-w-label">污染物浓度</span>' +
			'<div class="ff-w-pollutants">' +
			pollutant("PM2.5", "pm25") +
			pollutant("PM10", "pm10") +
			pollutant("O₃", "o3") +
			pollutant("NO₂", "no2") +
			pollutant("SO₂", "so2") +
			pollutant("CO", "co") +
			"</div>" +
			"</div>" +
			"</div>" +
			"</div>" +
			'<div class="ff-w-time">' +
			ico("schedule", "ff-w-time-ico") +
			'<span data-report-time></span>' +
			"</div>" +
			"</div>" +
			"</div>" +
			// 折叠按钮
			'<div class="ff-w-toggle-box">' +
			'<button type="button" class="ff-w-toggle" data-toggle aria-expanded="true">' +
			'<span class="ff-w-toggle-inner">' +
			ico("more-horiz", "ff-w-toggle-more") +
			ico("keyboard-arrow-up-rounded", "ff-w-toggle-less") +
			'<span class="ff-w-toggle-text" data-toggle-text>收起</span>' +
			"</span>" +
			"</button>" +
			"</div>" +
			"</div>";

		var box = document.createElement("div");
		box.innerHTML = html;
		return box.firstElementChild;
	}

	// ===================== 数据 =====================

	function readCache() {
		var raw = safeGet(window.localStorage, CACHE_KEY);
		if (!raw) return null;
		try {
			var cached = JSON.parse(raw);
			if (
				cached &&
				cached.data &&
				typeof cached.timestamp === "number" &&
				Date.now() - cached.timestamp < CACHE_TTL
			) {
				return cached.data;
			}
		} catch (error) {
			// 脏数据就当没有，走网络
		}
		return null;
	}

	function writeCache(data) {
		safeSet(
			window.localStorage,
			CACHE_KEY,
			JSON.stringify({ timestamp: Date.now(), data: data }),
		);
	}

	// ===================== 渲染 =====================

	var root = null;
	var contentEl = null;
	var loadingEl = null;
	var errorEl = null;
	var retryBtn = null;
	var collapsed = DEFAULT_COLLAPSED;

	function showState(kind, message) {
		if (loadingEl) loadingEl.hidden = kind !== "loading";
		if (errorEl) errorEl.hidden = kind !== "error";
		if (contentEl) contentEl.hidden = kind !== "content";
		if (kind === "error") text(root, "[data-error-text]", message);
	}

	function setAqi(root, data) {
		var valueEl = root.querySelector("[data-aqi]");
		var tagEl = root.querySelector("[data-aqi-category]");
		if (!valueEl || !tagEl) return;
		if (data.aqi == null) {
			valueEl.textContent = "--";
			tagEl.textContent = "";
			tagEl.className = "ff-w-aqi-tag";
			return;
		}
		valueEl.textContent = String(data.aqi);
		tagEl.textContent =
			data.aqi_category && data.aqi_category !== "NA"
				? data.aqi_category
				: "";
		tagEl.className = "ff-w-aqi-tag";
		if (data.aqi_level === 1) tagEl.classList.add("is-good");
		else if (data.aqi_level === 2) tagEl.classList.add("is-moderate");
		else if (data.aqi_level >= 3) tagEl.classList.add("is-bad");
	}

	function render(data) {
		if (!root || !data) return;

		text(root, "[data-city]", data.city || data.province);
		text(root, "[data-district]", data.district || "");
		text(root, "[data-temp]", data.temperature != null ? data.temperature : "--");
		text(root, "[data-desc]", data.weather || "");
		text(root, "[data-tmax]", data.temp_max != null ? data.temp_max : "--");
		text(root, "[data-tmin]", data.temp_min != null ? data.temp_min : "--");
		text(
			root,
			"[data-wind]",
			[data.wind_direction, data.wind_power].filter(Boolean).join(" "),
		);
		text(root, "[data-humidity]", data.humidity != null ? data.humidity + "%" : "--%");
		text(
			root,
			"[data-feels-like]",
			data.feels_like != null ? data.feels_like + "°C" : "--°C",
		);
		text(
			root,
			"[data-visibility]",
			data.visibility != null ? data.visibility + "km" : "--km",
		);
		text(root, "[data-pressure]", data.pressure != null ? data.pressure + "hPa" : "--hPa");
		text(root, "[data-uv]", data.uv != null ? data.uv : "--");
		text(
			root,
			"[data-precipitation]",
			data.precipitation != null ? data.precipitation + "mm" : "--mm",
		);
		text(root, "[data-cloud]", data.cloud != null ? data.cloud + "%" : "--%");
		text(
			root,
			"[data-report-time]",
			data.report_time || "",
		);

		// 日出/日落/降水概率在 forecast[0]（今天）里
		var today =
			Array.isArray(data.forecast) && data.forecast.length > 0
				? data.forecast[0]
				: null;
		text(root, "[data-sunrise]", (today && today.sunrise) || "--:--");
		text(root, "[data-sunset]", (today && today.sunset) || "--:--");
		text(
			root,
			"[data-pop]",
			today && today.pop != null ? today.pop + "%" : "--%",
		);

		// 污染物
		var pollutants = data.air_pollutants || {};
		["pm25", "pm10", "o3", "no2", "so2", "co"].forEach(function (key) {
			var node = root.querySelector("[data-" + key + "]");
			if (node) node.textContent = pollutants[key] != null ? pollutants[key] : "--";
		});

		setAqi(root, data);

		// 天气图标整块替换（path 是内联的，换一个 svg 最省事）
		var sky = root.querySelector("[data-sky]");
		if (sky) {
			sky.innerHTML = ico(iconForCode(data.weather_icon), "ff-w-sky-ico");
		}

		showState("content");
	}

	// ===================== 折叠 =====================

	function applyCollapsed(next) {
		collapsed = next;
		if (!root) return;
		root.classList.toggle("is-collapsed", collapsed);
		var btn = root.querySelector("[data-toggle]");
		var label = root.querySelector("[data-toggle-text]");
		if (btn) {
			btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
			btn.title = collapsed ? "展开" : "收起";
		}
		if (label) label.textContent = collapsed ? "展开" : "收起";
		safeSet(window.sessionStorage, VIEW_KEY, collapsed ? "1" : "0");
	}

	function bindToggle() {
		var btn = root.querySelector("[data-toggle]");
		if (!btn) return;
		btn.addEventListener("click", function () {
			applyCollapsed(!collapsed);
		});
	}

	// ===================== 加载 =====================

	var inflight = null;

	function load(force) {
		if (inflight) return inflight;

		if (!force) {
			var cached = readCache();
			if (cached) {
				render(cached);
				return Promise.resolve();
			}
		}

		showState("loading");
		var url = API_URL + (FIXED_CITY ? "&city=" + encodeURIComponent(FIXED_CITY) : "");

		inflight = fetch(url, { cache: "no-store" })
			.then(function (response) {
				if (!response.ok) throw new Error("HTTP " + response.status);
				return response.json();
			})
			.then(function (data) {
				if (!data || data.city == null) throw new Error("invalid payload");
				writeCache(data);
				render(data);
			})
			.catch(function (error) {
				if (window.console && console.warn) {
					console.warn("[ff-weather] 加载失败：", error);
				}
				showState("error", "天气加载失败，点这里重试");
			})
			.then(function () {
				inflight = null;
			});

		return inflight;
	}

	// ===================== 挂载 =====================

	function isMobileNow() {
		return !!(window.matchMedia && window.matchMedia(MOBILE_QUERY).matches);
	}

	// 桌面：右栏 top 组件容器（#right-sidebar 第一个子 div）末尾；
	// 移动端：底部组件栏 #bottom-sidebar 末尾。两个容器都在 swup 替换范围之外。
	function findMountPoint() {
		if (isMobileNow()) {
			var bar = document.getElementById("bottom-sidebar");
			if (bar) return { parent: bar, before: null };
			// 容器还没渲染就退回桌面逻辑，不显示好过报错
		}
		var sidebar = document.getElementById("right-sidebar");
		if (!sidebar) return null;
		var wrapper = sidebar.firstElementChild;
		if (!wrapper) return null;
		return { parent: wrapper, before: null };
	}

	function mount() {
		var point = findMountPoint();
		if (!point) {
			root.hidden = true;
			return;
		}
		if (root.parentNode !== point.parent) {
			if (point.before && point.before.parentNode === point.parent) {
				point.parent.insertBefore(root, point.before);
			} else {
				point.parent.appendChild(root);
			}
		}
		root.hidden = false;
		load(false);
	}

	function sync() {
		if (!root) return;
		if (SKIP_PATH.test(window.location.pathname || "/")) {
			root.hidden = true;
			return;
		}
		mount();
	}

	function init() {
		if (document.getElementById("ff-weather")) return; // 别重复注入
		root = buildCard();
		contentEl = root.querySelector("[data-content]");
		loadingEl = root.querySelector('[data-state="loading"]');
		errorEl = root.querySelector('[data-state="error"]');
		retryBtn = root.querySelector("[data-retry]");
		if (!contentEl || !loadingEl || !errorEl) return;

		// 折叠态：会话级记忆
		applyCollapsed(safeGet(window.sessionStorage, VIEW_KEY) === "1");

		if (retryBtn) {
			retryBtn.addEventListener("click", function () {
				load(true);
			});
		}
		bindToggle();

		// 先挂进 DOM 再取数据：插入要经过 mount()，而 mount() 里会顺手 load
		document.body.appendChild(root);
		root.hidden = true;
		sync();
	}

	document.addEventListener("astro:page-load", sync);
	document.addEventListener("swup:page:view", sync);
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}

	// 跨 768px 断点把节点搬到另一个挂载点（主题在该断点整块切换侧栏 / 底部栏）
	var motionQuery = window.matchMedia
		? window.matchMedia(MOBILE_QUERY)
		: null;
	if (motionQuery) {
		var onBreakpointChange = function () {
			sync();
		};
		if (motionQuery.addEventListener) {
			motionQuery.addEventListener("change", onBreakpointChange);
		} else if (motionQuery.addListener) {
			motionQuery.addListener(onBreakpointChange); // 旧版 Safari
		}
	}
})();
