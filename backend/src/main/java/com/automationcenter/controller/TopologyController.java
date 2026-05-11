package com.automationcenter.controller;

import com.automationcenter.service.TopologyService;
import com.automationcenter.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/topology")
@RequiredArgsConstructor
public class TopologyController {
    private final TopologyService topologyService;

    @GetMapping
    public ResponseEntity<TopologyService.TopologyGraph> getTopology(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(topologyService.buildGraph(user.getId()));
    }
}
