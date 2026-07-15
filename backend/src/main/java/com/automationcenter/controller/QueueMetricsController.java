package com.automationcenter.controller;

import com.automationcenter.dto.queue.QueueDepthResponse;
import com.automationcenter.service.QueueMetricsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/queue-metrics")
@RequiredArgsConstructor
public class QueueMetricsController {

    private final QueueMetricsService queueMetricsService;

    @GetMapping
    public ResponseEntity<List<QueueDepthResponse>> get() {
        return ResponseEntity.ok(queueMetricsService.getQueueDepths());
    }
}
