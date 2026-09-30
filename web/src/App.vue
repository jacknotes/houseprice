<template>
  <div>
    <header class="header">
      <div class="header-inner">
        <div class="brand">房价走势<small>城市 · 小区历史价格查询</small></div>
        <nav class="nav">
          <router-link to="/">全国总览</router-link>
          <router-link to="/city">城市走势</router-link>
          <router-link to="/community">小区趋势</router-link>
          <router-link to="/data">数据管理</router-link>
        </nav>
      </div>
    </header>
    <div class="container">
      <router-view :key="$route.fullPath" />
    </div>
    <div class="footer">
      数据来源：国家统计局70城房价指数（官方真实）· 安居客城市挂牌均价（真实抓取）· 小区数据为标注的模拟示例，支持导入真实数据
      <br />前端版本 v1.1（悬停图表显示“年月+数值”提示；若图表无提示请按 Ctrl+F5 强制刷新）
    </div>
  </div>
</template>
