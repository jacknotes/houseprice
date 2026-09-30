// City metadata: name -> [code, province, tier]
// Tier follows the conventional NBS grouping: 4 first-tier + 31 second-tier + 35 third-tier = 70 cities.
'use strict';

const M = {
  北京: ['beijing', '北京', '一线'], 上海: ['shanghai', '上海', '一线'], 广州: ['guangzhou', '广东', '一线'], 深圳: ['shenzhen', '广东', '一线'],
  天津: ['tianjin', '天津', '二线'], 石家庄: ['shijiazhuang', '河北', '二线'], 太原: ['taiyuan', '山西', '二线'], 呼和浩特: ['huhehaote', '内蒙古', '二线'],
  沈阳: ['shenyang', '辽宁', '二线'], 大连: ['dalian', '辽宁', '二线'], 长春: ['changchun', '吉林', '二线'], 哈尔滨: ['haerbin', '黑龙江', '二线'],
  南京: ['nanjing', '江苏', '二线'], 杭州: ['hangzhou', '浙江', '二线'], 宁波: ['ningbo', '浙江', '二线'], 合肥: ['hefei', '安徽', '二线'],
  福州: ['fuzhou', '福建', '二线'], 厦门: ['xiamen', '福建', '二线'], 南昌: ['nanchang', '江西', '二线'], 济南: ['jinan', '山东', '二线'],
  青岛: ['qingdao', '山东', '二线'], 郑州: ['zhengzhou', '河南', '二线'], 武汉: ['wuhan', '湖北', '二线'], 长沙: ['changsha', '湖南', '二线'],
  南宁: ['nanning', '广西', '二线'], 海口: ['haikou', '海南', '二线'], 重庆: ['chongqing', '重庆', '二线'], 成都: ['chengdu', '四川', '二线'],
  贵阳: ['guiyang', '贵州', '二线'], 昆明: ['kunming', '云南', '二线'], 西安: ['xian', '陕西', '二线'], 兰州: ['lanzhou', '甘肃', '二线'],
  西宁: ['xining', '青海', '二线'], 银川: ['yinchuan', '宁夏', '二线'], 乌鲁木齐: ['wulumuqi', '新疆', '二线'],
  唐山: ['tangshan', '河北', '三线'], 秦皇岛: ['qinhuangdao', '河北', '三线'], 包头: ['baotou', '内蒙古', '三线'], 丹东: ['dandong', '辽宁', '三线'],
  锦州: ['jinzhou', '辽宁', '三线'], 吉林: ['jilin', '吉林', '三线'], 牡丹江: ['mudanjiang', '黑龙江', '三线'], 无锡: ['wuxi', '江苏', '三线'],
  徐州: ['xuzhou', '江苏', '三线'], 扬州: ['yangzhou', '江苏', '三线'], 温州: ['wenzhou', '浙江', '三线'], 金华: ['jinhua', '浙江', '三线'],
  蚌埠: ['bengbu', '安徽', '三线'], 安庆: ['anqing', '安徽', '三线'], 泉州: ['quanzhou', '福建', '三线'], 九江: ['jiujiang', '江西', '三线'],
  赣州: ['ganzhou', '江西', '三线'], 烟台: ['yantai', '山东', '三线'], 济宁: ['jining', '山东', '三线'], 洛阳: ['luoyang', '河南', '三线'],
  平顶山: ['pingdingshan', '河南', '三线'], 宜昌: ['yichang', '湖北', '三线'], 襄阳: ['xiangyang', '湖北', '三线'], 岳阳: ['yueyang', '湖南', '三线'],
  常德: ['changde', '湖南', '三线'], 韶关: ['shaoguan', '广东', '三线'], 湛江: ['zhanjiang', '广东', '三线'], 惠州: ['huizhou', '广东', '三线'],
  桂林: ['guilin', '广西', '三线'], 北海: ['beihai', '广西', '三线'], 三亚: ['sanya', '海南', '三线'], 泸州: ['luzhou', '四川', '三线'],
  南充: ['nanchong', '四川', '三线'], 遵义: ['zunyi', '贵州', '三线'], 大理: ['dali', '云南', '三线'],
  // not in the 70-city program; level data from Anjuke
  咸宁: ['xianning', '湖北', '三线及以下'],
};

// extra aliases so user imports can use pinyin or code
const FEATURED = ['beijing', 'shanghai', 'guangzhou', 'shenzhen', 'xianning'];

module.exports = { M, FEATURED };
