package com.automationcenter.controller;

import com.automationcenter.dto.machine.MachineRequest;
import com.automationcenter.dto.machine.MachineResponse;
import com.automationcenter.dto.machine.SshCommandRequest;
import com.automationcenter.dto.machine.SshCommandResponse;
import com.automationcenter.entity.User;
import com.automationcenter.service.MachineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/machines")
@RequiredArgsConstructor
public class MachineController {

    private final MachineService machineService;

    @PostMapping
    public ResponseEntity<MachineResponse> create(
            @RequestBody @Valid MachineRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(machineService.create(request, user.getId()));
    }

    @GetMapping
    public ResponseEntity<List<MachineResponse>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(machineService.listByOwner(user.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<MachineResponse> get(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(machineService.getById(id, user.getId()));
    }

    @PutMapping("/{id}")
    public ResponseEntity<MachineResponse> update(
            @PathVariable Long id,
            @RequestBody @Valid MachineRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(machineService.update(id, request, user.getId()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        machineService.delete(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<Map<String, Object>> test(@PathVariable Long id, @AuthenticationPrincipal User user) {
        boolean ok = machineService.testConnection(id, user.getId());
        return ResponseEntity.ok(Map.of("online", ok));
    }

    @PostMapping("/{id}/exec")
    public ResponseEntity<SshCommandResponse> exec(
            @PathVariable Long id,
            @RequestBody @Valid SshCommandRequest request,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(machineService.exec(id, request.getCommand(), user.getId()));
    }
}
