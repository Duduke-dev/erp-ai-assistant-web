<script setup lang="ts">
import type { EChartsOption } from 'echarts'
import {
  BarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ChartSpec } from '@/types/api'

/**
 * 按需注册 ECharts 模块。
 *
 * 全量 `import * as echarts from 'echarts'` 会让对话页这一个 chunk 达到 1.2 MB
 * （gzip 412 KB），而实际只用到 8 种图表。按需注册后体积大幅下降，
 * 代价是新增图表类型时必须在这里补一行——这条注释就是为了让后来者知道该补在哪。
 */
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
])

/**
 * 图表渲染。
 *
 * 后端下发的是**纯数据协议**（type + title + categories + series），
 * 这里只做"按 type 翻译成 ECharts option"这一件事：
 * 不做任何字段推断、不执行 spec 里的任何内容。
 * 这样即使模型输出被污染，最坏结果也只是画出一张奇怪的图。
 */
const props = defineProps<{ chart: ChartSpec }>()

const container = ref<HTMLDivElement | null>(null)

let instance: echarts.ECharts | null = null

function buildOption(spec: ChartSpec): EChartsOption {
  const base: EChartsOption = {
    title: { text: spec.title, left: 'center', textStyle: { fontSize: 13, fontWeight: 500 } },
    tooltip: { trigger: spec.type === 'pie' || spec.type === 'funnel' ? 'item' : 'axis' },
    grid: { left: 48, right: 24, top: 48, bottom: 40 },
  }

  switch (spec.type) {
    case 'pie':
    case 'funnel': {
      // 饼图与漏斗只有一条系列，取第一条；缺失时给空数据而不是抛错
      const values = spec.series[0]?.values ?? []
      return {
        ...base,
        tooltip: { trigger: 'item' },
        series: [
          {
            type: spec.type,
            radius: spec.type === 'pie' ? ['35%', '65%'] : undefined,
            data: spec.categories.map((name, index) => ({ name, value: values[index] ?? 0 })),
          },
        ],
      }
    }

    case 'gauge': {
      // 仪表盘只取首个系列的首个值：多值会让刻度语义变得含糊
      const value = spec.series[0]?.values[0] ?? 0
      return {
        ...base,
        tooltip: { trigger: 'item' },
        series: [{ type: 'gauge', detail: { formatter: '{value}' }, data: [{ value, name: spec.series[0]?.name ?? '' }] }],
      }
    }

    case 'heatmap': {
      // 单系列时只有一行；多系列时每个系列一行
      const data: [number, number, number][] = []
      spec.series.forEach((serie, rowIndex) => {
        serie.values.forEach((value, columnIndex) => {
          data.push([columnIndex, rowIndex, Number(value)])
        })
      })
      const allValues = data.map((item) => item[2])
      return {
        ...base,
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: spec.categories },
        yAxis: { type: 'category', data: spec.series.map((serie) => serie.name) },
        visualMap: {
          min: Math.min(...allValues, 0),
          max: Math.max(...allValues, 1),
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
        },
        series: [{ type: 'heatmap', data }],
      }
    }

    case 'scatter': {
      const values = spec.series[0]?.values ?? []
      return {
        ...base,
        xAxis: { type: 'category', data: spec.categories },
        yAxis: { type: 'value' },
        series: [{ type: 'scatter', name: spec.series[0]?.name ?? '', data: values }],
      }
    }

    case 'area': {
      return {
        ...base,
        xAxis: { type: 'category', data: spec.categories, boundaryGap: false },
        yAxis: { type: 'value' },
        series: spec.series.map((serie) => ({
          type: 'line',
          name: serie.name,
          data: serie.values,
          areaStyle: {},
          smooth: true,
        })),
      }
    }

    case 'line': {
      return {
        ...base,
        xAxis: { type: 'category', data: spec.categories },
        yAxis: { type: 'value' },
        series: spec.series.map((serie) => ({ type: 'line', name: serie.name, data: serie.values, smooth: false })),
      }
    }

    case 'bar':
    default: {
      return {
        ...base,
        xAxis: { type: 'category', data: spec.categories },
        yAxis: { type: 'value' },
        series: spec.series.map((serie) => ({ type: 'bar', name: serie.name, data: serie.values })),
      }
    }
  }
}

function render(): void {
  if (!instance) {
    return
  }
  // notMerge：切换图表类型时若不整体替换，上一次的坐标轴/系列会残留
  instance.setOption(buildOption(props.chart), true)
}

function resize(): void {
  instance?.resize()
}

onMounted(() => {
  if (container.value) {
    instance = echarts.init(container.value)
    render()
    window.addEventListener('resize', resize)
  }
})

watch(() => props.chart, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  instance?.dispose()
  instance = null
})
</script>

<template>
  <div ref="container" class="h-[300px] w-full" />
</template>
